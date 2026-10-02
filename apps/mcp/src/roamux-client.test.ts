import { describe, expect, test } from "bun:test"
import {
  type Envelope,
  type HostToRelay,
  type RemoteCommand,
  type Transport,
  createEnvelope,
  parseWith,
  serialize,
} from "@openremote/protocol"
import { ClientToRelayEnvelopeSchema } from "@openremote/protocol"
import { RoamuxClient, type TransportFactory } from "./roamux-client.js"

/**
 * Unit tests for the MCP RoamuxClient. No live Ably, no model — a fake Transport
 * captures the command the client sends and lets the test feed back host replies
 * (same injection discipline as the agent adapters).
 */

type FakeTransport = Transport & {
  channel: string
  sent: string[]
  /** Push a frame as if it arrived from the host. */
  deliver: (frame: string) => void
}

function fakeFactory(): { factory: TransportFactory; transports: FakeTransport[] } {
  const transports: FakeTransport[] = []
  const factory: TransportFactory = (channel) => {
    const messageHandlers = new Set<(f: string) => void>()
    const openHandlers = new Set<() => void>()
    const t: FakeTransport = {
      channel,
      sent: [],
      isOpen: true,
      connect() {
        // open synchronously; fire open handlers on next tick
        queueMicrotask(() => {
          for (const h of openHandlers) h()
        })
      },
      send(frame) {
        t.sent.push(frame)
      },
      onMessage(h) {
        messageHandlers.add(h)
        return () => messageHandlers.delete(h)
      },
      onOpen(h) {
        openHandlers.add(h)
        return () => openHandlers.delete(h)
      },
      onClose() {
        return () => {}
      },
      close() {},
      deliver(frame) {
        for (const h of messageHandlers) h(frame)
      },
    }
    transports.push(t)
    return t
  }
  return { factory, transports }
}

/** Build a host→client reply frame on the given channel's transport. */
function hostReply(message: HostToRelay): string {
  const env: Envelope<HostToRelay> = createEnvelope(message, { deviceId: "host:test" })
  return serialize(env)
}

/** Decode the single command the client sent on a transport. */
function sentCommand(t: FakeTransport): RemoteCommand {
  expect(t.sent.length).toBe(1)
  const parsed = parseWith(ClientToRelayEnvelopeSchema, t.sent[0]!)
  if (!parsed.ok) throw new Error(`bad frame: ${parsed.error}`)
  const msg = parsed.value.message
  if (msg.kind !== "command") throw new Error(`expected command, got ${msg.kind}`)
  return msg.command
}

function makeClient(factory: TransportFactory): RoamuxClient {
  return new RoamuxClient({ userId: "u1", activityWindowMs: 5, transportFactory: factory })
}

describe("RoamuxClient command mapping", () => {
  test("listSessions sends sessions.list and returns the snapshot", async () => {
    const { factory, transports } = fakeFactory()
    const client = makeClient(factory)
    const p = client.listSessions("h1")
    // the one transport for this call
    await Promise.resolve()
    const t = transports[0]!
    t.deliver(
      hostReply({
        kind: "sessions.snapshot",
        sessions: [{ id: "s1", title: "fix tests", status: "running" }],
      }),
    )
    const sessions = await p
    expect(sentCommand(t)).toEqual({ type: "sessions.list" })
    expect(t.channel).toContain("user:u1:host:h1:control")
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.id).toBe("s1")
  })

  test("startSession sends session.create with project + harness", async () => {
    const { factory, transports } = fakeFactory()
    const client = makeClient(factory)
    const p = client.startSession("h1", "proj_abc", "claude-code", "hello")
    await Promise.resolve()
    const t = transports[0]!
    t.deliver(hostReply({ kind: "sessions.snapshot", sessions: [] }))
    await p
    expect(sentCommand(t)).toEqual({
      type: "session.create",
      projectId: "proj_abc",
      harnessType: "claude-code",
      initialPrompt: "hello",
    })
  })

  test("sendPrompt sends prompt.send on the SESSION channel and returns events", async () => {
    const { factory, transports } = fakeFactory()
    const client = makeClient(factory)
    const p = client.sendPrompt("h1", "s1", "do it")
    await Promise.resolve()
    const t = transports[0]!
    t.deliver(hostReply({ kind: "event", event: { type: "assistant.message", text: "on it" } }))
    const events = await p
    expect(sentCommand(t)).toEqual({ type: "prompt.send", sessionId: "s1", text: "do it" })
    expect(t.channel).toContain("user:u1:host:h1:session:s1")
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe("assistant.message")
  })

  test("respondPermission sends permission.respond with allow/deny", async () => {
    const { factory, transports } = fakeFactory()
    const client = makeClient(factory)
    const p = client.respondPermission("h1", "s1", "perm_9", "allow")
    await Promise.resolve()
    const t = transports[0]!
    const events = await p
    expect(sentCommand(t)).toEqual({
      type: "permission.respond",
      sessionId: "s1",
      permissionId: "perm_9",
      response: "allow",
    })
    expect(events).toEqual([])
  })

  test("stopSession sends session.abort", async () => {
    const { factory, transports } = fakeFactory()
    const client = makeClient(factory)
    const p = client.stopSession("h1", "s1")
    await Promise.resolve()
    const t = transports[0]!
    await p
    expect(sentCommand(t)).toEqual({ type: "session.abort", sessionId: "s1" })
  })

  test("getActivity is read-only (sends nothing) and returns delivered events", async () => {
    const { factory, transports } = fakeFactory()
    const client = makeClient(factory)
    const p = client.getActivity("h1", "s1")
    await Promise.resolve()
    const t = transports[0]!
    t.deliver(hostReply({ kind: "event", event: { type: "agent.completed" } }))
    const events = await p
    expect(t.sent).toHaveLength(0)
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe("agent.completed")
  })
})
