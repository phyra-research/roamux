import {
  AblyTransport,
  type AgentEvent,
  type AgentSession,
  type HostCapabilities,
  type HostInfo,
  type RelayToClient,
  RelayToClientEnvelopeSchema,
  type RemoteCommand,
  type Transport,
  controlChannel,
  createEnvelope,
  newId,
  parseWith,
  serialize,
  sessionChannel,
} from "@openremote/protocol"
import { nodeRealtimeCtor } from "@openremote/protocol/ably-node"

/**
 * Builds a Transport for a channel. Injected so tests can supply a fake pipe and
 * never touch a live Ably connection (same discipline as the agent adapters).
 */
export type TransportFactory = (channel: string) => Transport

export type RoamuxClientOptions = {
  userId: string
  /** Stable id for this MCP endpoint (presence/tracing). */
  deviceId?: string
  /** How long to gather events after a command before resolving (ms). */
  activityWindowMs: number
  /** Override the transport (tests). Defaults to a real AblyTransport. */
  transportFactory: TransportFactory
}

/** A real AblyTransport factory from an API key — the production/self-host path. */
export function ablyTransportFactory(apiKey: string, clientId: string): TransportFactory {
  return (channel) =>
    new AblyTransport({
      channel,
      apiKey,
      clientId,
      RealtimeImpl: nodeRealtimeCtor(),
    })
}

/**
 * RoamuxClient — a thin, request-scoped roamux *client* for the MCP server.
 *
 * It is NOT a long-lived connection manager: each high-level call opens the
 * channel(s) it needs, sends one enveloped command, collects the replies that
 * arrive within a short window, then closes. That maps cleanly onto MCP's
 * request/response tool model while roamux's own traffic is streaming — the
 * `activityWindowMs` window is the bridge, and `getActivity` can be polled again
 * to catch later events.
 *
 * Everything on the wire is the SAME envelope/command/event the web UI uses; the
 * MCP server sits exactly where the browser sits (seam #1), so there are no host
 * or protocol changes here.
 */
export class RoamuxClient {
  private readonly userId: string
  private readonly deviceId: string
  private readonly windowMs: number
  private readonly make: TransportFactory

  constructor(opts: RoamuxClientOptions) {
    this.userId = opts.userId
    this.deviceId = opts.deviceId ?? `mcp:${newId()}`
    this.windowMs = opts.activityWindowMs
    this.make = opts.transportFactory
  }

  /** Open a transport, run `fn`, and always close it (even on throw). */
  private async withChannel<T>(channel: string, fn: (t: Transport) => Promise<T>): Promise<T> {
    const t = this.make(channel)
    t.connect()
    try {
      return await fn(t)
    } finally {
      t.close()
    }
  }

  /** Send one command on a channel and collect decoded replies for `windowMs`. */
  private async sendAndCollect(
    channel: string,
    command: RemoteCommand,
    windowMs = this.windowMs,
  ): Promise<RelayToClient[]> {
    return this.withChannel(channel, (t) => {
      return new Promise<RelayToClient[]>((resolve) => {
        const received: RelayToClient[] = []
        const off = t.onMessage((frame) => {
          const parsed = parseWith(RelayToClientEnvelopeSchema, frame)
          if (parsed.ok) received.push(parsed.value.message)
        })
        // Send once the pipe is open; if already open, send now.
        const fire = () => {
          const env = createEnvelope(
            { kind: "command" as const, command },
            { deviceId: this.deviceId },
          )
          t.send(serialize(env))
        }
        if (t.isOpen) fire()
        else t.onOpen(fire)
        setTimeout(() => {
          off()
          resolve(received)
        }, windowMs)
      })
    })
  }

  /** Collect replies on a channel WITHOUT sending (passive read window). */
  private async collect(channel: string, windowMs = this.windowMs): Promise<RelayToClient[]> {
    return this.withChannel(channel, (t) => {
      return new Promise<RelayToClient[]>((resolve) => {
        const received: RelayToClient[] = []
        const off = t.onMessage((frame) => {
          const parsed = parseWith(RelayToClientEnvelopeSchema, frame)
          if (parsed.ok) received.push(parsed.value.message)
        })
        setTimeout(() => {
          off()
          resolve(received)
        }, windowMs)
      })
    })
  }

  // ── High-level operations the MCP tools call ───────────────────────────────

  /** Ask a host for its current sessions. */
  async listSessions(hostId: string): Promise<AgentSession[]> {
    const channel = controlChannel(hostId, this.userId)
    const msgs = await this.sendAndCollect(channel, { type: "sessions.list" })
    const snap = lastOfKind(msgs, "sessions.snapshot")
    return snap?.sessions ?? []
  }

  /** Ask a host for its approved projects + installed harnesses. */
  async listProjects(hostId: string): Promise<HostCapabilities | null> {
    const channel = controlChannel(hostId, this.userId)
    const msgs = await this.sendAndCollect(channel, { type: "projects.list" })
    const snap = lastOfKind(msgs, "projects.snapshot")
    return snap?.capabilities ?? null
  }

  /** Create a session on a host for an approved project + harness. */
  async startSession(
    hostId: string,
    projectId: string,
    harnessType: string,
    initialPrompt?: string,
  ): Promise<AgentSession[]> {
    const channel = controlChannel(hostId, this.userId)
    const msgs = await this.sendAndCollect(channel, {
      type: "session.create",
      projectId,
      harnessType,
      ...(initialPrompt ? { initialPrompt } : {}),
    })
    const snap = lastOfKind(msgs, "sessions.snapshot")
    return snap?.sessions ?? []
  }

  /** Send a prompt to a running session; returns events seen in the window. */
  async sendPrompt(hostId: string, sessionId: string, text: string): Promise<AgentEvent[]> {
    const channel = sessionChannel(hostId, sessionId, this.userId)
    const msgs = await this.sendAndCollect(channel, { type: "prompt.send", sessionId, text })
    return eventsOf(msgs)
  }

  /** Poll a session's activity: a read-only window of recent events. */
  async getActivity(hostId: string, sessionId: string): Promise<AgentEvent[]> {
    const channel = sessionChannel(hostId, sessionId, this.userId)
    const msgs = await this.collect(channel)
    return eventsOf(msgs)
  }

  /** Stop a running session. */
  async stopSession(hostId: string, sessionId: string): Promise<void> {
    const channel = sessionChannel(hostId, sessionId, this.userId)
    await this.sendAndCollect(channel, { type: "session.abort", sessionId })
  }

  /** Respond to a pending permission request (allow/deny). */
  async respondPermission(
    hostId: string,
    sessionId: string,
    permissionId: string,
    response: "allow" | "deny",
  ): Promise<AgentEvent[]> {
    const channel = sessionChannel(hostId, sessionId, this.userId)
    const msgs = await this.sendAndCollect(channel, {
      type: "permission.respond",
      sessionId,
      permissionId,
      response,
    })
    return eventsOf(msgs)
  }

  /** Current host presence for a host (from its control channel state). */
  async getHost(hostId: string): Promise<HostInfo | null> {
    const channel = controlChannel(hostId, this.userId)
    const msgs = await this.collect(channel)
    const state = lastOfKind(msgs, "host.state")
    return state?.info ?? null
  }
}

/** Narrow to the last message of a given kind (discriminated union). */
function lastOfKind<K extends RelayToClient["kind"]>(
  msgs: RelayToClient[],
  kind: K,
): Extract<RelayToClient, { kind: K }> | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m && m.kind === kind) return m as Extract<RelayToClient, { kind: K }>
  }
  return undefined
}

/** Pull the agent events out of a batch of relay messages, in order. */
function eventsOf(msgs: RelayToClient[]): AgentEvent[] {
  const out: AgentEvent[] = []
  for (const m of msgs) if (m.kind === "event") out.push(m.event)
  return out
}
