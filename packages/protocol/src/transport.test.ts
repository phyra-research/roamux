import { describe, expect, test } from "bun:test"
import { WebSocketTransport } from "./transport.js"

/**
 * A minimal fake WebSocket that lets tests drive open/message/close without a
 * real socket. Mirrors the tiny slice of the WebSocket API WebSocketTransport
 * uses: readyState, OPEN, addEventListener, send, close.
 */
class FakeWebSocket {
  static OPEN = 1
  static CLOSED = 3
  readyState = 0
  sent: string[] = []
  private listeners: Record<string, Array<(ev?: unknown) => void>> = {}
  static instances: FakeWebSocket[] = []

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, fn: (ev?: unknown) => void) {
    const list = this.listeners[type] ?? []
    list.push(fn)
    this.listeners[type] = list
  }
  send(frame: string) {
    this.sent.push(frame)
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.emit("close")
  }
  // test helpers
  emit(type: string, ev?: unknown) {
    for (const fn of this.listeners[type] ?? []) fn(ev)
  }
  open() {
    this.readyState = FakeWebSocket.OPEN
    this.emit("open")
  }
  message(data: string) {
    this.emit("message", { data })
  }
}

function makeTransport(reconnect = false) {
  FakeWebSocket.instances = []
  const t = new WebSocketTransport({
    url: "ws://test/host",
    reconnect,
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
  })
  return { t, sockets: () => FakeWebSocket.instances }
}

describe("WebSocketTransport", () => {
  test("dials the given url on connect", () => {
    const { t, sockets } = makeTransport()
    t.connect()
    expect(sockets()).toHaveLength(1)
    expect(sockets()[0]!.url).toBe("ws://test/host")
  })

  test("onOpen fires and isOpen reflects state", () => {
    const { t, sockets } = makeTransport()
    let opened = 0
    t.onOpen(() => opened++)
    t.connect()
    expect(t.isOpen).toBe(false)
    sockets()[0]!.open()
    expect(opened).toBe(1)
    expect(t.isOpen).toBe(true)
  })

  test("send is a no-op until open, then writes frames", () => {
    const { t, sockets } = makeTransport()
    t.connect()
    t.send("early") // dropped: not open
    sockets()[0]!.open()
    t.send("hello")
    expect(sockets()[0]!.sent).toEqual(["hello"])
  })

  test("onMessage delivers inbound frames", () => {
    const { t, sockets } = makeTransport()
    const got: string[] = []
    t.onMessage((f) => got.push(f))
    t.connect()
    sockets()[0]!.open()
    sockets()[0]!.message("frame-1")
    expect(got).toEqual(["frame-1"])
  })

  test("reconnects after unexpected close when enabled", async () => {
    const { t, sockets } = makeTransport(true)
    t.connect()
    sockets()[0]!.open()
    sockets()[0]!.close() // unexpected
    // backoff is 500ms; wait a bit past it
    await new Promise((r) => setTimeout(r, 650))
    expect(sockets().length).toBeGreaterThanOrEqual(2)
  })

  test("close() stops reconnection", async () => {
    const { t, sockets } = makeTransport(true)
    t.connect()
    sockets()[0]!.open()
    t.close()
    await new Promise((r) => setTimeout(r, 650))
    expect(sockets()).toHaveLength(1)
  })

  test("unsubscribe stops handler from firing", () => {
    const { t, sockets } = makeTransport()
    const got: string[] = []
    const off = t.onMessage((f) => got.push(f))
    t.connect()
    sockets()[0]!.open()
    off()
    sockets()[0]!.message("ignored")
    expect(got).toEqual([])
  })
})
