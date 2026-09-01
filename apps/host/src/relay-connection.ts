import type { AgentAdapter } from "@openremote/agent-adapters"
import {
  ClientToRelayEnvelopeSchema,
  type HostInfo,
  type HostToRelay,
  createEnvelope,
  parseWith,
  serialize,
} from "@openremote/protocol"
import { handleCommand } from "./command-handler.js"
import type { HostStore } from "./store.js"

export type RelayConnectionOptions = {
  relayUrl: string
  adapter: AgentAdapter
  store: HostStore
  deviceId: string
  pairingToken: string
  hostInfo: () => HostInfo
  log?: (msg: string) => void
}

/**
 * Owns the outbound WebSocket to the relay, the reconnect loop, and the two
 * pumps: adapter events → relay (with sequence numbers) and relay commands →
 * adapter. The host ALWAYS dials out; the relay never dials the host.
 */
export class RelayConnection {
  private ws: WebSocket | null = null
  private closed = false
  private backoffMs = 500
  private eventPumpStarted = false
  private readonly log: (msg: string) => void

  constructor(private readonly opts: RelayConnectionOptions) {
    this.log = opts.log ?? (() => {})
  }

  start(): void {
    this.connect()
    this.startEventPump()
  }

  stop(): void {
    this.closed = true
    this.ws?.close()
  }

  private connect(): void {
    if (this.closed) return
    const url = `${this.opts.relayUrl.replace(/\/$/, "")}/host`
    this.log(`connecting to ${url} …`)

    const ws = new WebSocket(url)
    this.ws = ws

    ws.addEventListener("open", () => {
      this.backoffMs = 500
      this.log("connected to relay")
      this.sendHello()
      void this.sendSnapshot()
    })

    ws.addEventListener("message", (ev) => {
      const raw = typeof ev.data === "string" ? ev.data : String(ev.data)
      void this.onCommandFrame(raw)
    })

    ws.addEventListener("close", () => {
      if (this.closed) return
      this.log(`relay connection closed; reconnecting in ${this.backoffMs}ms`)
      this.ws = null
      setTimeout(() => this.connect(), this.backoffMs)
      this.backoffMs = Math.min(this.backoffMs * 2, 10_000)
    })

    ws.addEventListener("error", () => {
      // 'close' handles reconnect; keep this quiet to avoid double logging.
    })
  }

  private send(message: HostToRelay, sessionId?: string, sequence?: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const env = createEnvelope(message, {
      deviceId: this.opts.deviceId,
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(sequence !== undefined ? { sequence } : {}),
    })
    this.ws.send(serialize(env))
  }

  private sendHello(): void {
    this.send({ kind: "host.hello", token: this.opts.pairingToken, info: this.opts.hostInfo() })
  }

  private async sendSnapshot(): Promise<void> {
    try {
      const sessions = await this.opts.adapter.listSessions()
      this.send({ kind: "sessions.snapshot", sessions })
    } catch (err) {
      this.log(`failed to list sessions: ${(err as Error).message}`)
    }
  }

  private async onCommandFrame(raw: string): Promise<void> {
    const parsed = parseWith(ClientToRelayEnvelopeSchema, raw)
    if (!parsed.ok) {
      this.log(`drop bad command frame: ${parsed.error}`)
      return
    }
    const msg = parsed.value.message
    if (msg.kind !== "command") return

    try {
      const replies = await handleCommand(this.opts.adapter, msg.command)
      for (const reply of replies) this.send(reply)
    } catch (err) {
      this.log(`command ${msg.command.type} failed: ${(err as Error).message}`)
    }
  }

  /**
   * Drain the adapter's event stream forever, tagging each event with a
   * monotonically increasing per-session sequence number and forwarding it.
   * Started once; survives reconnects (buffered events simply flush when the
   * socket is back up — dropped if still down, which M3 resume will fix).
   */
  private startEventPump(): void {
    if (this.eventPumpStarted) return
    this.eventPumpStarted = true
    void (async () => {
      for await (const { sessionId, event } of this.opts.adapter.events()) {
        if (this.closed) break
        const sequence = this.opts.store.nextSequence(sessionId)
        this.send({ kind: "event", event }, sessionId, sequence)
      }
    })()
  }
}
