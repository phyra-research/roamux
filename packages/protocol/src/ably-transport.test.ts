import { describe, expect, test } from "bun:test"
import type * as Ably from "ably"
import { AblyTransport } from "./ably-transport.js"
import { controlChannel, sessionChannel } from "./channels.js"

/**
 * A minimal fake Ably Realtime that lets us drive connection state + channel
 * pub/sub without a network or key. Mirrors the slice AblyTransport uses:
 * connection.on/state, channels.get, channel.subscribe/publish.
 */
class FakeChannel {
  subscribers: Array<(msg: { data: unknown }) => void> = []
  published: { name: string; data: unknown }[] = []
  subscribe(_name: string, cb: (msg: { data: unknown }) => void) {
    this.subscribers.push(cb)
    return Promise.resolve()
  }
  publish(name: string, data: unknown) {
    this.published.push({ name, data })
    return Promise.resolve()
  }
  deliver(data: unknown) {
    for (const cb of this.subscribers) cb({ data })
  }
}

class FakeConnection {
  state = "initialized"
  private handlers: Record<string, Array<() => void>> = {}
  on(event: string, cb: () => void) {
    const list = this.handlers[event] ?? []
    list.push(cb)
    this.handlers[event] = list
  }
  emit(event: string) {
    this.state = event
    for (const cb of this.handlers[event] ?? []) cb()
  }
}

class FakeRealtime {
  connection = new FakeConnection()
  channelsByName = new Map<string, FakeChannel>()
  closed = false
  lastOptions: unknown
  channels = {
    get: (name: string) => {
      let ch = this.channelsByName.get(name)
      if (!ch) {
        ch = new FakeChannel()
        this.channelsByName.set(name, ch)
      }
      return ch
    },
  }
  constructor(opts: unknown) {
    this.lastOptions = opts
  }
  close() {
    this.closed = true
  }
}

function makeTransport(channel = "test:channel") {
  const t = new AblyTransport({
    channel,
    apiKey: "fake:key",
    clientId: "host-1",
    RealtimeImpl: FakeRealtime as unknown as typeof Ably.Realtime,
  })
  // Reach the fake once connected.
  const realtime = () =>
    (t as unknown as { client: FakeRealtime | null }).client as FakeRealtime | null
  return { t, realtime }
}

describe("AblyTransport", () => {
  test("requires some auth option", () => {
    expect(() => new AblyTransport({ channel: "c" })).toThrow(/apiKey, authUrl, authCallback/)
  })

  test("connect creates a client and isOpen tracks 'connected' state", () => {
    const { t, realtime } = makeTransport()
    let opened = 0
    t.onOpen(() => opened++)
    expect(t.isOpen).toBe(false)
    t.connect()
    expect(realtime()).not.toBeNull()
    expect(t.isOpen).toBe(false) // not yet connected
    realtime()!.connection.emit("connected")
    expect(opened).toBe(1)
    expect(t.isOpen).toBe(true)
  })

  test("send publishes a frame on the channel", () => {
    const { t, realtime } = makeTransport("openremote:c")
    t.connect()
    realtime()!.connection.emit("connected")
    t.send("hello-frame")
    const ch = realtime()!.channelsByName.get("openremote:c")!
    expect(ch.published).toHaveLength(1)
    expect(ch.published[0]!.data).toBe("hello-frame")
  })

  test("onMessage receives frames delivered on the channel", () => {
    const { t, realtime } = makeTransport("openremote:c")
    const got: string[] = []
    t.onMessage((f) => got.push(f))
    t.connect()
    realtime()!.channelsByName.get("openremote:c")!.deliver("inbound-1")
    expect(got).toEqual(["inbound-1"])
  })

  test("non-string channel data is ignored", () => {
    const { t, realtime } = makeTransport("openremote:c")
    const got: string[] = []
    t.onMessage((f) => got.push(f))
    t.connect()
    realtime()!.channelsByName.get("openremote:c")!.deliver({ not: "a string" })
    expect(got).toEqual([])
  })

  test("connection down states fire onClose", () => {
    const { t, realtime } = makeTransport()
    let closed = 0
    t.onClose(() => closed++)
    t.connect()
    realtime()!.connection.emit("disconnected")
    expect(closed).toBe(1)
  })

  test("close() shuts the client and stops isOpen", () => {
    const { t, realtime } = makeTransport()
    t.connect()
    realtime()!.connection.emit("connected")
    const client = realtime()!
    t.close()
    expect(client.closed).toBe(true)
    expect(t.isOpen).toBe(false)
  })
})

describe("channel names", () => {
  test("control channel is user+host scoped", () => {
    expect(controlChannel("h1")).toBe("openremote:user:local:host:h1:control")
    expect(controlChannel("h1", "u9")).toBe("openremote:user:u9:host:h1:control")
  })
  test("session channel is user+host+session scoped", () => {
    expect(sessionChannel("h1", "s2")).toBe("openremote:user:local:host:h1:session:s2")
  })
})
