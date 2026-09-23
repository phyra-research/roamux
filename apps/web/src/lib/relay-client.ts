import {
  AblyTransport,
  type AgentEvent,
  type AgentSession,
  type HostCapabilities,
  type HostInfo,
  type RelayToClientEnvelope,
  RelayToClientEnvelopeSchema,
  type RemoteCommand,
  type Transport,
  WebSocketTransport,
  createEnvelope,
  newId,
  pairingChannel,
  parseWith,
  serialize,
} from "@openremote/protocol"
import type { RealtimeCtor } from "@openremote/protocol"
import type { ConnectionStatus, DiffView, PendingPermission, TimelineEntry } from "./types"

/** How the client reaches the host: via the local relay WS, or via Ably. */
export type ClientTransportConfig =
  | { kind: "ws"; relayUrl: string }
  // realtimeCtor is resolved via a dynamic import in the provider so Ably's
  // browser build only loads in an async chunk when Ably mode is actually used.
  // authCallback fetches a short-lived scoped token from our API — the browser
  // never holds the raw Ably key (Beta §10.3). `tokenUrl` is that API endpoint.
  | { kind: "ably"; tokenUrl: string; realtimeCtor: RealtimeCtor }

/** The full client-side view of the world, recomputed into an immutable snapshot. */
export type RelayState = {
  status: ConnectionStatus
  token: string | null
  hosts: HostInfo[]
  sessions: AgentSession[]
  /** sessionId → ordered timeline */
  timelines: Record<string, TimelineEntry[]>
  /** sessionId → streaming assistant text buffer (from deltas) */
  streaming: Record<string, string>
  /** sessionId → pending permission (if any) */
  permissions: Record<string, PendingPermission>
  /** sessionId → latest diff snapshot (from diff.request) */
  diffs: Record<string, DiffView>
  /** Host capabilities for the New Session picker (approved projects + harnesses). */
  capabilities: HostCapabilities | null
  /** Has this client ever reached "connected" since the current RelayClient
   * instance was created? Drives the reconnecting banner (#112) — a fresh
   * connect/pairing attempt shouldn't read as a "reconnect". */
  everConnected: boolean
}

const EMPTY: RelayState = {
  status: "disconnected",
  token: null,
  hosts: [],
  sessions: [],
  timelines: {},
  streaming: {},
  permissions: {},
  diffs: {},
  capabilities: null,
  everConnected: false,
}

/** The initial (pre-connect) snapshot, exported for the provider's fallback. */
export const INITIAL_STATE: RelayState = EMPTY

const TOKEN_KEY = "openremote.token"
const CLIENT_ID_KEY = "openremote.clientId"

/**
 * Vanilla (framework-free) relay client. Owns the browser→relay WebSocket,
 * applies incoming messages into an immutable state snapshot, and notifies
 * subscribers. React binds to it via useSyncExternalStore.
 */
export class RelayClient {
  private transport: Transport | null = null
  private state: RelayState = EMPTY
  private listeners = new Set<() => void>()
  private clientId: string
  private wantConnected = false

  constructor(private readonly config: ClientTransportConfig) {
    this.clientId = readClientId()
    const token = readToken()
    this.state = { ...EMPTY, token }
  }

  // ── subscription API (useSyncExternalStore) ────────────────────────────────
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = (): RelayState => this.state

  private set(patch: Partial<RelayState>): void {
    // Centralized so every status-setting call site (hello ack, host-list
    // merge, account-mode connect, ...) gets this for free (#112) rather than
    // each one remembering to latch it.
    const everConnected = this.state.everConnected || patch.status === "connected"
    this.state = { ...this.state, ...patch, everConnected }
    for (const l of this.listeners) l()
  }

  /**
   * Build the transport for the current mode. Over WS it dials the relay's
   * /client endpoint. Over Ably it joins the pairing-token channel — so it can
   * only be built once we have a token (returns null otherwise). Both transports
   * own their own reconnect loop.
   */
  /** Account mode: the channel to connect on, set via connectToHost(). */
  private accountChannel: string | null = null

  private buildTransport(): Transport | null {
    if (this.config.kind === "ws") {
      const url = `${this.config.relayUrl.replace(/\/$/, "")}/client`
      return new WebSocketTransport({ url })
    }
    // Account mode: connect on the host's account-scoped channel (no pair token).
    // Fall back to the pairing channel (pre-account / local dev) when set.
    const channel =
      this.accountChannel ?? (this.state.token ? pairingChannel(this.state.token) : null)
    if (!channel) return null
    const tokenUrl = this.config.tokenUrl
    return new AblyTransport({
      channel,
      // Fetch a short-lived scoped TokenRequest from our API — no raw key here.
      // NOTE: do NOT set clientId — the token already carries it (client:{userId}).
      // Passing a different one causes Ably's "clientId mismatch" error.
      authCallback: (_params, cb) => {
        fetch(tokenUrl, { method: "POST" })
          .then((r) => r.json())
          .then((tokenRequest) => cb(null, tokenRequest))
          .catch((err) => cb((err as Error).message, null))
      },
      RealtimeImpl: this.config.realtimeCtor,
    })
  }

  /**
   * Connect to a specific account host over its account-scoped Ably channel
   * (no pairing token). Signed-in browsers use this after picking a host.
   */
  connectToHost(channel: string): void {
    if (this.config.kind !== "ably") return
    // Idempotent: if we're already on this channel, do nothing. Otherwise a
    // re-render that re-fires the auto-connect effect would tear down the live
    // connection and rebuild it — dropping in-flight requests (e.g. the
    // projects.list behind "Loading projects…").
    if (this.accountChannel === channel && this.transport) return
    this.accountChannel = channel
    this.transport?.close()
    this.transport = null
    this.wantConnected = false
    // Clear the previous host's data so we never show one host's sessions/
    // projects under another. They repopulate from the new host's snapshots.
    this.set({
      sessions: [],
      capabilities: null,
      timelines: {},
      streaming: {},
      permissions: {},
      diffs: {},
    })
    this.connect()
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  connect(): void {
    this.wantConnected = true
    if (this.transport) return
    const transport = this.buildTransport()
    if (!transport) {
      // Ably with no token yet: nothing to connect to until pairing supplies one.
      this.set({ status: "unpaired" })
      return
    }
    this.transport = transport
    this.set({ status: "connecting" })

    transport.onOpen(() => {
      // Account mode: no pairing token — announce ourselves so the host replies
      // with its state + session/project snapshots (which flips us to connected).
      if (this.accountChannel) {
        this.set({ status: "connected" })
        this.sendHello("")
        this.sendCommand({ type: "sessions.list" })
        this.sendCommand({ type: "projects.list" })
        return
      }
      const token = this.state.token
      if (token) this.sendHello(token)
      else this.set({ status: "unpaired" })
    })
    transport.onMessage((raw) => this.onMessage(raw))
    transport.onClose(() => {
      if (this.wantConnected) this.set({ status: "connecting" })
    })
    transport.connect()
  }

  disconnect(): void {
    this.wantConnected = false
    this.transport?.close()
    this.transport = null
    this.set({ status: "disconnected" })
  }

  // ── pairing ────────────────────────────────────────────────────────────────
  pair(token: string): void {
    const clean = token.trim()
    writeToken(clean)
    this.set({ token: clean })
    // Over Ably the channel is derived from the token, so a new token means a
    // fresh transport. Over WS we can reuse an open socket and just re-hello.
    if (this.config.kind === "ably") {
      this.transport?.close()
      this.transport = null
      this.connect()
    } else if (this.transport?.isOpen) {
      this.sendHello(clean)
    } else {
      this.connect()
    }
  }

  unpair(): void {
    writeToken(null)
    const wasConnected = this.transport?.isOpen ?? false
    if (this.config.kind === "ably") {
      this.transport?.close()
      this.transport = null
    }
    this.set({ ...EMPTY, token: null, status: wasConnected ? "unpaired" : "disconnected" })
  }

  private sendHello(token: string): void {
    this.send({ kind: "client.hello", token })
  }

  // ── commands ────────────────────────────────────────────────────────────────
  sendCommand(command: RemoteCommand): void {
    this.send({ kind: "command", command })
  }

  private send(
    message: { kind: "client.hello"; token: string } | { kind: "command"; command: RemoteCommand },
  ): void {
    if (!this.transport?.isOpen) {
      // Silent command loss is a recurring source of "nothing happened" bugs —
      // e.g. a page that never opened a connection (a refreshed /session/[id]).
      // Warn so it shows up in devtools instead of vanishing.
      console.warn(
        "[relay] not connected — dropped outbound",
        message.kind === "command" ? message.command.type : message.kind,
      )
      return
    }
    const env = createEnvelope(message, { deviceId: this.clientId })
    this.transport.send(serialize(env))
  }

  // ── inbound handling ─────────────────────────────────────────────────────────
  private onMessage(raw: string): void {
    const parsed = parseWith(RelayToClientEnvelopeSchema, raw)
    if (!parsed.ok) return
    this.apply(parsed.value)
  }

  private apply(env: RelayToClientEnvelope): void {
    const msg = env.message
    switch (msg.kind) {
      case "ack": {
        if (msg.ok) this.set({ status: "connected" })
        else if (msg.error === "not paired" || this.state.token === null)
          this.set({ status: "unpaired" })
        return
      }
      case "hosts.list": {
        this.mergeHosts(msg.hosts)
        return
      }
      case "sessions.snapshot": {
        this.set({ sessions: dedupeSessions(msg.sessions) })
        return
      }
      case "projects.snapshot": {
        this.set({ capabilities: msg.capabilities })
        return
      }
      case "host.state": {
        this.mergeHosts([msg.info])
        return
      }
      case "event": {
        this.applyEvent(env.sessionId, env.sequence, msg.event)
        return
      }
    }
  }

  private mergeHosts(incoming: HostInfo[]): void {
    const byId = new Map(this.state.hosts.map((h) => [h.deviceId, h]))
    for (const h of incoming) byId.set(h.deviceId, h)
    this.set({ hosts: [...byId.values()], status: "connected" })
  }

  private applyEvent(
    sessionId: string | undefined,
    sequence: number | undefined,
    event: AgentEvent,
  ): void {
    if (!sessionId) return

    // diff.snapshot is a request/response payload, not timeline activity — stash
    // it by session for <DiffView> and stop.
    if (event.type === "diff.snapshot") {
      this.set({
        diffs: {
          ...this.state.diffs,
          [sessionId]: { files: event.files, error: event.error, at: Date.now() },
        },
      })
      return
    }

    const timelines = { ...this.state.timelines }
    const streaming = { ...this.state.streaming }
    const permissions = { ...this.state.permissions }
    const list = timelines[sessionId] ? [...timelines[sessionId]] : []

    // run.* are lifecycle markers (session/run split) with no timeline line in
    // the V0 UI. They still flush a pending stream buffer, but add no entry.
    const isRunLifecycle =
      event.type === "run.started" || event.type === "run.completed" || event.type === "run.failed"

    if (event.type === "assistant.delta") {
      // Fold deltas into a running buffer instead of one entry per token.
      streaming[sessionId] = (streaming[sessionId] ?? "") + event.text
    } else {
      // Any non-delta flushes the streaming buffer into a message entry first.
      if (streaming[sessionId]) {
        list.push({
          key: `${sessionId}:stream:${list.length}`,
          event: { type: "assistant.message", text: streaming[sessionId] as string },
          at: Date.now(),
        })
        delete streaming[sessionId]
      }
      if (!isRunLifecycle) {
        list.push({
          key: `${sessionId}:${sequence ?? list.length}:${event.type}`,
          sequence,
          event,
          at: Date.now(),
        })
      }
    }

    if (event.type === "permission.requested") {
      permissions[sessionId] = {
        sessionId,
        permissionId: event.permissionId,
        description: event.description,
        tool: event.tool,
      }
    }
    if (event.type === "permission.resolved") {
      delete permissions[sessionId]
    }

    timelines[sessionId] = list
    this.updateSessionStatus(sessionId, event)
    this.set({ timelines, streaming, permissions })
  }

  private updateSessionStatus(sessionId: string, event: AgentEvent): void {
    const status: AgentSession["status"] | null =
      event.type === "agent.completed"
        ? "idle"
        : event.type === "agent.failed"
          ? "error"
          : event.type === "agent.waiting" || event.type === "permission.requested"
            ? "waiting"
            : event.type === "session.started" || event.type === "tool.started"
              ? "running"
              : null
    if (!status) return
    const sessions = this.state.sessions.map((s) => (s.id === sessionId ? { ...s, status } : s))
    // Autovivify a session row if we get events before a snapshot.
    if (!sessions.some((s) => s.id === sessionId)) {
      sessions.push({ id: sessionId, title: sessionId.slice(0, 8), status })
    }
    this.set({ sessions })
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function dedupeSessions(sessions: AgentSession[]): AgentSession[] {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  return [...byId.values()]
}

function readToken(): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(TOKEN_KEY)
}
function writeToken(token: string | null): void {
  if (typeof window === "undefined") return
  if (token) window.localStorage.setItem(TOKEN_KEY, token)
  else window.localStorage.removeItem(TOKEN_KEY)
}
function readClientId(): string {
  if (typeof window === "undefined") return "ssr-client"
  let id = window.localStorage.getItem(CLIENT_ID_KEY)
  if (!id) {
    // Use the protocol's isomorphic id (works on insecure LAN-IP origins too).
    id = newId()
    window.localStorage.setItem(CLIENT_ID_KEY, id)
  }
  return id
}
