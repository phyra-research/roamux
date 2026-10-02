import {
  type AgentEvent,
  type AgentSession,
  type HostCapabilities,
  type RelayToClient,
  RelayToClientEnvelopeSchema,
  type RemoteCommand,
  controlChannel,
  createEnvelope,
  newId,
  parseWith,
  serialize,
  sessionChannel,
} from "@openremote/protocol"
import * as Ably from "ably"

/**
 * REST-based roamux client for **serverless** environments (the Vercel
 * `/api/mcp` route).
 *
 * Why not the Realtime client? Ably Realtime uses a persistent WebSocket, which
 * does not reliably establish inside a short-lived serverless invocation — the
 * command never publishes and no reply arrives (observed: full-window timeout,
 * host never sees the command). Ably **REST** needs no socket: it publishes over
 * HTTP and reads replies from channel **history**. Verified working end to end
 * against a live host.
 *
 * Flow per call: REST-publish the command, then poll the channel's history until
 * the expected reply kind appears (or a timeout). The host is unchanged — it
 * still subscribes over Realtime and replies on the same channel; REST history
 * lets us read that reply without holding a socket.
 */
export type RoamuxRestClientOptions = {
  apiKey: string
  userId: string
  deviceId?: string
  /** Max time to poll history for the expected reply. */
  timeoutMs?: number
  /** How often to poll history. */
  pollMs?: number
}

export class RoamuxRestClient {
  private readonly rest: Ably.Rest
  private readonly userId: string
  private readonly deviceId: string
  private readonly timeoutMs: number
  private readonly pollMs: number

  constructor(opts: RoamuxRestClientOptions) {
    this.rest = new Ably.Rest({ key: opts.apiKey })
    this.userId = opts.userId
    this.deviceId = opts.deviceId ?? `mcp:${newId()}`
    this.timeoutMs = opts.timeoutMs ?? 15000
    this.pollMs = opts.pollMs ?? 600
  }

  /**
   * Publish a command on `channel`, then poll history until a reply of
   * `awaitKind` that is NEWER than the publish appears. Returns all decoded
   * replies seen at/after publish time.
   */
  private async sendAndAwait(
    channel: string,
    command: RemoteCommand,
    awaitKind: RelayToClient["kind"],
  ): Promise<RelayToClient[]> {
    const ch = this.rest.channels.get(channel)
    const publishedAt = Date.now()
    const env = createEnvelope({ kind: "command" as const, command }, { deviceId: this.deviceId })
    await ch.publish("frame", serialize(env))

    const deadline = publishedAt + this.timeoutMs
    while (Date.now() < deadline) {
      await sleep(this.pollMs)
      // Newest-first; only messages at/after our publish are candidate replies.
      const page = await ch.history({ limit: 25, direction: "backwards" })
      const replies: RelayToClient[] = []
      let found = false
      for (const msg of page.items) {
        const ts = typeof msg.timestamp === "number" ? msg.timestamp : 0
        if (ts < publishedAt) continue
        if (typeof msg.data !== "string") continue
        const parsed = parseWith(RelayToClientEnvelopeSchema, msg.data)
        if (!parsed.ok) continue
        replies.push(parsed.value.message)
        if (parsed.value.message.kind === awaitKind) found = true
      }
      if (found) return replies
    }
    return []
  }

  /** Publish a command without awaiting a specific reply (fire + brief drain). */
  private async sendAndDrain(channel: string, command: RemoteCommand): Promise<RelayToClient[]> {
    const ch = this.rest.channels.get(channel)
    const publishedAt = Date.now()
    const env = createEnvelope({ kind: "command" as const, command }, { deviceId: this.deviceId })
    await ch.publish("frame", serialize(env))
    await sleep(this.pollMs * 3)
    const page = await ch.history({ limit: 25, direction: "backwards" })
    const out: RelayToClient[] = []
    for (const msg of page.items) {
      const ts = typeof msg.timestamp === "number" ? msg.timestamp : 0
      if (ts < publishedAt || typeof msg.data !== "string") continue
      const parsed = parseWith(RelayToClientEnvelopeSchema, msg.data)
      if (parsed.ok) out.push(parsed.value.message)
    }
    return out
  }

  // ── Same operations as RoamuxClient, REST-backed ───────────────────────────

  async listSessions(hostId: string): Promise<AgentSession[]> {
    const msgs = await this.sendAndAwait(
      controlChannel(hostId, this.userId),
      { type: "sessions.list" },
      "sessions.snapshot",
    )
    return lastOfKind(msgs, "sessions.snapshot")?.sessions ?? []
  }

  async listProjects(hostId: string): Promise<HostCapabilities | null> {
    const msgs = await this.sendAndAwait(
      controlChannel(hostId, this.userId),
      { type: "projects.list" },
      "projects.snapshot",
    )
    return lastOfKind(msgs, "projects.snapshot")?.capabilities ?? null
  }

  async startSession(
    hostId: string,
    projectId: string,
    harnessType: string,
    initialPrompt?: string,
  ): Promise<AgentSession[]> {
    const msgs = await this.sendAndAwait(
      controlChannel(hostId, this.userId),
      {
        type: "session.create",
        projectId,
        harnessType,
        ...(initialPrompt ? { initialPrompt } : {}),
      },
      "sessions.snapshot",
    )
    return lastOfKind(msgs, "sessions.snapshot")?.sessions ?? []
  }

  async sendPrompt(hostId: string, sessionId: string, text: string): Promise<AgentEvent[]> {
    const msgs = await this.sendAndDrain(sessionChannel(hostId, sessionId, this.userId), {
      type: "prompt.send",
      sessionId,
      text,
    })
    return eventsOf(msgs)
  }

  async getActivity(hostId: string, sessionId: string): Promise<AgentEvent[]> {
    // Read-only: just read recent history on the session channel.
    const ch = this.rest.channels.get(sessionChannel(hostId, sessionId, this.userId))
    const page = await ch.history({ limit: 50, direction: "backwards" })
    const out: AgentEvent[] = []
    for (const msg of page.items) {
      if (typeof msg.data !== "string") continue
      const parsed = parseWith(RelayToClientEnvelopeSchema, msg.data)
      if (parsed.ok && parsed.value.message.kind === "event") out.push(parsed.value.message.event)
    }
    return out.reverse() // chronological
  }

  async stopSession(hostId: string, sessionId: string): Promise<void> {
    await this.sendAndDrain(sessionChannel(hostId, sessionId, this.userId), {
      type: "session.abort",
      sessionId,
    })
  }

  async respondPermission(
    hostId: string,
    sessionId: string,
    permissionId: string,
    response: "allow" | "deny",
  ): Promise<AgentEvent[]> {
    const msgs = await this.sendAndDrain(sessionChannel(hostId, sessionId, this.userId), {
      type: "permission.respond",
      sessionId,
      permissionId,
      response,
    })
    return eventsOf(msgs)
  }
}

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

function eventsOf(msgs: RelayToClient[]): AgentEvent[] {
  const out: AgentEvent[] = []
  for (const m of msgs) if (m.kind === "event") out.push(m.event)
  return out
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
