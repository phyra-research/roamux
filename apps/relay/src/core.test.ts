import { describe, expect, test } from "bun:test"
import {
  type HostInfo,
  RelayToClientEnvelopeSchema,
  createEnvelope,
  parseWith,
  serialize,
} from "@openremote/protocol"
import { type Connection, RelayCore } from "./core.js"

class FakeConn implements Connection {
  readonly sent: string[] = []
  constructor(readonly id: string) {}
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {}
  /** Decode the last received RelayToClient message kind, for assertions. */
  lastKind(): string | undefined {
    const last = this.sent.at(-1)
    if (!last) return undefined
    const p = parseWith(RelayToClientEnvelopeSchema, last)
    return p.ok ? p.value.message.kind : undefined
  }
}

const HOST_INFO: HostInfo = {
  deviceId: "dev-1",
  name: "test-mac",
  online: true,
  adapter: "mock",
  activeSessions: 1,
}

function hostHello(token: string) {
  return serialize(
    createEnvelope({ kind: "host.hello" as const, token, info: HOST_INFO }, { deviceId: "dev-1" }),
  )
}
function clientHello(token: string) {
  return serialize(
    createEnvelope({ kind: "client.hello" as const, token }, { deviceId: "client-1" }),
  )
}
function command() {
  return serialize(
    createEnvelope(
      {
        kind: "command" as const,
        command: { type: "prompt.send" as const, sessionId: "s1", text: "hi" },
      },
      { deviceId: "client-1" },
    ),
  )
}
function eventFrame(text: string) {
  return serialize(
    createEnvelope(
      { kind: "event" as const, event: { type: "assistant.delta" as const, text } },
      { deviceId: "dev-1", sessionId: "s1", sequence: 1 },
    ),
  )
}

describe("RelayCore pairing + routing", () => {
  test("client with matching token receives host presence", () => {
    const core = new RelayCore()
    const host = new FakeConn("host-1")
    const client = new FakeConn("client-1")

    core.addClient(client)
    core.handleHostMessage(host, hostHello("tok-abc"))
    core.handleClientMessage(client, clientHello("tok-abc"))

    // ack + hosts.list expected
    const kinds = client.sent.map((s) => {
      const p = parseWith(RelayToClientEnvelopeSchema, s)
      return p.ok ? p.value.message.kind : "?"
    })
    expect(kinds).toContain("ack")
    expect(kinds).toContain("hosts.list")
  })

  test("command from paired client reaches the host verbatim", () => {
    const core = new RelayCore()
    const host = new FakeConn("host-1")
    const client = new FakeConn("client-1")

    core.addClient(client)
    core.handleHostMessage(host, hostHello("tok-abc"))
    core.handleClientMessage(client, clientHello("tok-abc"))

    const cmd = command()
    core.handleClientMessage(client, cmd)
    expect(host.sent).toContain(cmd)
  })

  test("unpaired client cannot send commands", () => {
    const core = new RelayCore()
    const host = new FakeConn("host-1")
    const client = new FakeConn("client-1")

    core.addClient(client)
    core.handleHostMessage(host, hostHello("tok-abc"))
    // no client.hello
    core.handleClientMessage(client, command())

    expect(host.sent.length).toBe(0)
    expect(client.lastKind()).toBe("ack") // "not paired" nack
  })

  test("client with wrong token gets no host and cannot route", () => {
    const core = new RelayCore()
    const host = new FakeConn("host-1")
    const client = new FakeConn("client-1")

    core.addClient(client)
    core.handleHostMessage(host, hostHello("tok-abc"))
    core.handleClientMessage(client, clientHello("tok-WRONG"))
    core.handleClientMessage(client, command())

    expect(host.sent.length).toBe(0)
  })

  test("host events fan out only to clients holding its token", () => {
    const core = new RelayCore()
    const host = new FakeConn("host-1")
    const good = new FakeConn("client-good")
    const other = new FakeConn("client-other")

    core.addClient(good)
    core.addClient(other)
    core.handleHostMessage(host, hostHello("tok-abc"))
    core.handleClientMessage(good, clientHello("tok-abc"))
    core.handleClientMessage(other, clientHello("tok-different"))

    const ev = eventFrame("streaming…")
    core.handleHostMessage(host, ev)

    expect(good.sent).toContain(ev)
    expect(other.sent).not.toContain(ev)
  })

  test("host disconnect marks host offline for its clients", () => {
    const core = new RelayCore()
    const host = new FakeConn("host-1")
    const client = new FakeConn("client-1")

    core.addClient(client)
    core.handleHostMessage(host, hostHello("tok-abc"))
    core.handleClientMessage(client, clientHello("tok-abc"))
    core.removeConnection("host-1")

    const last = client.sent.at(-1)
    const p = last ? parseWith(RelayToClientEnvelopeSchema, last) : null
    expect(p?.ok).toBe(true)
    if (p?.ok && p.value.message.kind === "hosts.list") {
      expect(p.value.message.hosts[0]?.online).toBe(false)
    }
  })

  test("malformed frames are dropped, not thrown", () => {
    const core = new RelayCore()
    const client = new FakeConn("client-1")
    core.addClient(client)
    expect(() => core.handleClientMessage(client, "{garbage")).not.toThrow()
    expect(client.lastKind()).toBe("ack") // nack with error
  })
})
