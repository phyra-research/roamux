/**
 * Transport is how OpenRemote moves bytes between an endpoint (host daemon or
 * client) and the rest of the system. It is the seam that lets us replace the
 * V0 LAN WebSocket relay with a production transport (Ably) later WITHOUT
 * touching the protocol, adapters, or UI (see docs/beta-architecture.md §3).
 *
 * V0 ships exactly one implementation — `WebSocketTransport` — which wraps the
 * raw browser/Bun `WebSocket` the host and web client already used. This is a
 * behavior-preserving extraction: same dial-out, same reconnect semantics,
 * just behind an interface.
 *
 * A Transport carries opaque string frames. Framing/serialization and Zod
 * validation stay in the protocol layer above it — the transport neither parses
 * nor understands envelopes. That keeps it dumb and swappable.
 */
export interface Transport {
  /** Open the connection. Resolves once dialing has started (not necessarily open). */
  connect(): void

  /** Send one already-serialized frame. No-op if not currently open. */
  send(frame: string): void

  /** Register a handler for inbound frames. Returns an unsubscribe function. */
  onMessage(handler: (frame: string) => void): () => void

  /** Register a handler invoked when the underlying connection opens. */
  onOpen(handler: () => void): () => void

  /** Register a handler invoked when the underlying connection closes. */
  onClose(handler: () => void): () => void

  /** Whether a frame sent right now would actually go out. */
  readonly isOpen: boolean

  /** Close the connection and stop any reconnect loop. */
  close(): void
}

export type WebSocketTransportOptions = {
  /** Full ws:// or wss:// URL to dial. */
  url: string
  /** Reconnect after an unexpected close. Default true. */
  reconnect?: boolean
  /** Initial reconnect backoff in ms. Default 500. */
  initialBackoffMs?: number
  /** Max reconnect backoff in ms. Default 10_000. */
  maxBackoffMs?: number
  /**
   * WebSocket constructor. Defaults to the global. Injectable so tests can
   * drive a fake without a real socket.
   */
  WebSocketImpl?: typeof WebSocket
}

type Handler<T extends unknown[]> = (...args: T) => void

/**
 * WebSocket-backed Transport with the exact reconnect behavior the host's
 * RelayConnection and the web client already implemented: dial out, exponential
 * backoff with a cap, silent on error (close drives reconnect).
 */
export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null
  private closed = false
  private backoffMs: number
  private readonly maxBackoffMs: number
  private readonly initialBackoffMs: number
  private readonly reconnect: boolean
  private readonly url: string
  private readonly WebSocketImpl: typeof WebSocket

  private readonly messageHandlers = new Set<Handler<[string]>>()
  private readonly openHandlers = new Set<Handler<[]>>()
  private readonly closeHandlers = new Set<Handler<[]>>()

  constructor(opts: WebSocketTransportOptions) {
    this.url = opts.url
    this.reconnect = opts.reconnect ?? true
    this.initialBackoffMs = opts.initialBackoffMs ?? 500
    this.maxBackoffMs = opts.maxBackoffMs ?? 10_000
    this.backoffMs = this.initialBackoffMs
    // why: allow tests to inject a fake WebSocket without a live server.
    this.WebSocketImpl = opts.WebSocketImpl ?? (globalThis.WebSocket as typeof WebSocket)
  }

  get isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === this.WebSocketImpl.OPEN
  }

  connect(): void {
    if (this.closed) return
    const ws = new this.WebSocketImpl(this.url)
    this.ws = ws

    ws.addEventListener("open", () => {
      this.backoffMs = this.initialBackoffMs
      for (const h of this.openHandlers) h()
    })

    ws.addEventListener("message", (ev: MessageEvent) => {
      const raw = typeof ev.data === "string" ? ev.data : String(ev.data)
      for (const h of this.messageHandlers) h(raw)
    })

    ws.addEventListener("close", () => {
      this.ws = null
      for (const h of this.closeHandlers) h()
      if (this.closed || !this.reconnect) return
      setTimeout(() => this.connect(), this.backoffMs)
      this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs)
    })

    ws.addEventListener("error", () => {
      // why: 'close' handles reconnect; stay quiet to avoid double-logging.
    })
  }

  send(frame: string): void {
    if (!this.isOpen) return
    this.ws!.send(frame)
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
    this.ws?.close()
  }
}
