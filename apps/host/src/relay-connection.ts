import type { HarnessAdapter } from "@openremote/agent-adapters"
import {
  ClientToRelayEnvelopeSchema,
  type HostInfo,
  type HostToRelay,
  type Transport,
  WebSocketTransport,
  createEnvelope,
  parseWith,
  serialize,
} from "@openremote/protocol"
import { handleCommand } from "./command-handler.js"
import type { HostStore } from "./store.js"

export type RelayConnectionOptions = {
  relayUrl: string
  adapter: HarnessAdapter
  store: HostStore
  deviceId: string
  pairingToken: string
  hostInfo: () => HostInfo
  log?: (msg: string) => void
  /**
   * Transport factory. Defaults to a WebSocketTransport dialing the relay's
   * `/host` endpoint. Injectable so tests can drive a fake transport, and so a
   * future AblyTransport slots in without touching this class.
   */
  createTransport?: (url: string) => Transport
}

/**
 * Owns the outbound connection to the relay (via a Transport), the reconnect
 * loop, and the two pumps: adapter events → relay (with sequence numbers) and
 * relay commands → adapter. The host ALWAYS dials out; the relay never dials
 * the host.
 */
export class RelayConnection {
  private readonly transport: Transport
  private closed = false
  private eventPumpStarted = false
  private readonly log: (msg: string) => void

  constructor(private readonly opts: RelayConnectionOptions) {
    this.log = opts.log ?? (() => {})
    const url = `${this.opts.relayUrl.replace(/\/$/, "")}/host`
    this.transport = (opts.createTransport ?? ((u) => new WebSocketTransport({ url: u })))(url)

    this.transport.onOpen(() => {
      this.log("connected to relay")
      this.sendHello()
      void this.sendSnapshot()
    })
    this.transport.onMessage((raw) => void this.onCommandFrame(raw))
    this.transport.onClose(() => {
      if (this.closed) return
      this.log("relay connection closed; reconnecting")
    })
  }

  start(): void {
    this.log("connecting to relay …")
    this.transport.connect()
    this.startEventPump()
  }

  stop(): void {
    this.closed = true
    this.transport.close()
  }

  private send(message: HostToRelay, sessionId?: string, sequence?: number): void {
    if (!this.transport.isOpen) return
    const env = createEnvelope(message, {
      deviceId: this.opts.deviceId,
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(sequence !== undefined ? { sequence } : {}),
    })
    this.transport.send(serialize(env))
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
