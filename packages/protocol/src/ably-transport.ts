import * as Ably from "ably"
import type { Transport } from "./transport.js"

/**
 * AblyTransport — the production `Transport` (Beta). It carries the SAME opaque
 * string frames as WebSocketTransport, but over an Ably Realtime channel instead
 * of a raw relay socket. Adopting Ably gives us durable sessions, reconnect, and
 * history for free (Beta §18) — none of which the protocol layer above needs to
 * know about.
 *
 * One AblyTransport == one channel == one logical "pipe". The host and client
 * each construct transports for the channels they need (control + per-session,
 * see the channel-name helpers below). Framing/serialization + Zod validation
 * stay above this; the transport just publishes/subscribes strings.
 *
 * Auth: pass either an `apiKey` (dev/self-host) OR an `authUrl`/`authCallback`
 * that returns a short-lived token (production — never ship an API key to a
 * browser, Beta §10.3). A `clientId` identifies this endpoint for presence.
 */
export type AblyTransportOptions = {
  /** The channel this transport publishes/subscribes on. */
  channel: string
  /** Dev/self-host: an Ably API key. Prefer token auth in production. */
  apiKey?: string
  /** Production: URL the SDK calls to fetch a short-lived token. */
  authUrl?: string
  /** Production: callback returning a token/tokenRequest. */
  authCallback?: Ably.AuthOptions["authCallback"]
  /** Stable id for this endpoint (host or client), used for presence/tracing. */
  clientId?: string
  /**
   * Injectable Realtime constructor for tests (a fake Ably). Defaults to the
   * real `Ably.Realtime`.
   */
  RealtimeImpl?: typeof Ably.Realtime
}

/** The single Ably message name we publish frames under on every channel. */
const FRAME_NAME = "frame"

type Handler<T extends unknown[]> = (...args: T) => void

export class AblyTransport implements Transport {
  private client: Ably.Realtime | null = null
  private channel: Ably.RealtimeChannel | null = null
  private closed = false
  private readonly opts: AblyTransportOptions
  private readonly RealtimeImpl: typeof Ably.Realtime

  private readonly messageHandlers = new Set<Handler<[string]>>()
  private readonly openHandlers = new Set<Handler<[]>>()
  private readonly closeHandlers = new Set<Handler<[]>>()

  constructor(opts: AblyTransportOptions) {
    if (!opts.apiKey && !opts.authUrl && !opts.authCallback) {
      throw new Error("AblyTransport requires one of: apiKey, authUrl, authCallback")
    }
    this.opts = opts
    this.RealtimeImpl = opts.RealtimeImpl ?? Ably.Realtime
  }

  get isOpen(): boolean {
    return this.client?.connection.state === "connected" && this.channel !== null
  }

  connect(): void {
    if (this.closed || this.client) return

    // why: assemble only the auth option that was provided; Ably requires
    // exactly one of key / authUrl / authCallback.
    const clientOptions: Ably.ClientOptions = {
      ...(this.opts.apiKey ? { key: this.opts.apiKey } : {}),
      ...(this.opts.authUrl ? { authUrl: this.opts.authUrl } : {}),
      ...(this.opts.authCallback ? { authCallback: this.opts.authCallback } : {}),
      ...(this.opts.clientId ? { clientId: this.opts.clientId } : {}),
    }

    const client = new this.RealtimeImpl(clientOptions)
    this.client = client
    const channel = client.channels.get(this.opts.channel)
    this.channel = channel

    // Ably auto-reconnects internally; we surface open/close on the connection
    // state so the layer above behaves like it did with WebSocketTransport.
    client.connection.on("connected", () => {
      for (const h of this.openHandlers) h()
    })
    const onDown = () => {
      for (const h of this.closeHandlers) h()
    }
    client.connection.on("disconnected", onDown)
    client.connection.on("suspended", onDown)
    client.connection.on("failed", onDown)

    void channel.subscribe(FRAME_NAME, (msg: Ably.InboundMessage) => {
      if (typeof msg.data === "string") {
        for (const h of this.messageHandlers) h(msg.data)
      }
    })
  }

  send(frame: string): void {
    if (!this.channel) return
    // Fire-and-forget publish; Ably queues while (re)connecting.
    void this.channel.publish(FRAME_NAME, frame)
  }

  onMessage(handler: (frame: string) => void): () => void {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  onOpen(handler: () => void): () => void {
    this.openHandlers.add(handler)
    return () => this.openHandlers.delete(handler)
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  close(): void {
    this.closed = true
    this.channel = null
    this.client?.close()
    this.client = null
  }
}
