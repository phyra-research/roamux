import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { MockAgentAdapter } from "@openremote/agent-adapters"
import {
  type AgentEvent,
  type RelayToClientEnvelope,
  RelayToClientEnvelopeSchema,
  type RemoteCommand,
  createEnvelope,
  parseWith,
  serialize,
} from "@openremote/protocol"
import { startRelayServer } from "@openremote/relay/server"
import { RelayConnection } from "./relay-connection.js"
import { HostStore } from "./store.js"

/**
 * Full vertical slice over REAL WebSockets:
 *   MockAgentAdapter → RelayConnection (host) → relay → raw WS (browser)
 * plus commands flowing the other way. This is the automated version of the
 * milestone-1 acceptance test.
 */

const PAIRING_TOKEN = "e2e-token-123"

let relay: ReturnType<typeof startRelayServer>
let port: number
let adapter: MockAgentAdapter
let store: HostStore
let host: RelayConnection

/** A tiny browser-side client for the test: connects, pairs, records events. */
class TestClient {
  private ws: WebSocket
  readonly events: { sessionId?: string; sequence?: number; event: AgentEvent }[] = []
  readonly messages: RelayToClientEnvelope["message"][] = []
  private waiters: Array<() => void> = []

  constructor(url: string) {
    this.ws = new WebSocket(url)
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve()
      this.ws.onerror = () => reject(new Error("client ws error"))
      this.ws.onmessage = (ev) => this.onMessage(typeof ev.data === "string" ? ev.data : "")
    })
  }

  private onMessage(raw: string): void {
    const parsed = parseWith(RelayToClientEnvelopeSchema, raw)
    if (!parsed.ok) return
    this.messages.push(parsed.value.message)
    if (parsed.value.message.kind === "event") {
      this.events.push({
        sessionId: parsed.value.sessionId,
        sequence: parsed.value.sequence,
        event: parsed.value.message.event,
      })
    }
    for (const w of this.waiters.splice(0)) w()
  }

  pair(token: string): void {
    this.ws.send(
      serialize(createEnvelope({ kind: "client.hello", token }, { deviceId: "browser" })),
    )
  }

  command(command: RemoteCommand): void {
    this.ws.send(serialize(createEnvelope({ kind: "command", command }, { deviceId: "browser" })))
  }

  /** Send a command with a FIXED messageId, to simulate transport redelivery. */
  commandWithId(command: RemoteCommand, messageId: string): void {
    this.ws.send(
      serialize(createEnvelope({ kind: "command", command }, { deviceId: "browser", messageId })),
    )
  }

  /** Resolve once `predicate` over collected event types is satisfied. */
  waitForEvent(
    predicate: (types: AgentEvent["type"][]) => boolean,
    timeoutMs = 5000,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (predicate(this.events.map((e) => e.event.type))) {
          resolve()
          return true
        }
        return false
      }
      if (check()) return
      const timer = setTimeout(() => reject(new Error("timeout waiting for event")), timeoutMs)
      const tick = () => {
        if (check()) clearTimeout(timer)
        else this.waiters.push(tick)
      }
      this.waiters.push(tick)
    })
  }

  close(): void {
    this.ws.close()
  }
}

beforeAll(async () => {
  relay = startRelayServer({ port: 0, hostname: "127.0.0.1" })
  port = relay.server.port ?? 0

  adapter = new MockAgentAdapter({ seedSession: true, stepMs: 10 })
  store = new HostStore(":memory:")
  await adapter.start()

  host = new RelayConnection({
    relayUrl: `ws://127.0.0.1:${port}`,
    adapter,
    store,
    deviceId: "host-dev",
    pairingToken: PAIRING_TOKEN,
    hostInfo: () => ({
      deviceId: "host-dev",
      name: "e2e-mac",
      online: true,
      adapter: "mock",
      activeSessions: 1,
    }),
  })
  host.start()
  // Give the host a moment to dial the relay and send hello.
  await new Promise((r) => setTimeout(r, 150))
})

afterAll(async () => {
  host.stop()
  await adapter.stop()
  store.close()
  relay.server.stop(true)
})

describe("vertical slice (milestone 1)", () => {
  test("browser pairs, sees host online and the seeded session", async () => {
    const client = new TestClient(`ws://127.0.0.1:${port}/client`)
    await client.open()
    client.pair(PAIRING_TOKEN)
    client.command({ type: "sessions.list" })

    await new Promise((r) => setTimeout(r, 150))

    const hostsList = client.messages.find((m) => m.kind === "hosts.list")
    expect(hostsList).toBeDefined()
    if (hostsList?.kind === "hosts.list") {
      expect(hostsList.hosts[0]?.name).toBe("e2e-mac")
      expect(hostsList.hosts[0]?.online).toBe(true)
    }

    const snapshot = client.messages.find((m) => m.kind === "sessions.snapshot")
    expect(snapshot).toBeDefined()
    if (snapshot?.kind === "sessions.snapshot") {
      expect(snapshot.sessions.some((s) => s.id === "mock-session-1")).toBe(true)
    }
    client.close()
  })

  test("prompt from browser streams events back with increasing sequence numbers", async () => {
    const client = new TestClient(`ws://127.0.0.1:${port}/client`)
    await client.open()
    client.pair(PAIRING_TOKEN)
    await new Promise((r) => setTimeout(r, 80))

    client.command({
      type: "prompt.send",
      sessionId: "mock-session-1",
      text: "Inspect this repository and tell me what it does.",
    })

    await client.waitForEvent((types) => types.includes("agent.completed"))

    const types = client.events.map((e) => e.event.type)
    expect(types).toContain("tool.started")
    expect(types).toContain("tool.completed")
    expect(types).toContain("assistant.message")
    expect(types).toContain("agent.completed")

    // Sequence numbers for this session must be strictly increasing.
    const seqs = client.events
      .filter((e) => e.sessionId === "mock-session-1")
      .map((e) => e.sequence ?? 0)
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!)
    }
    client.close()
  })

  test("stop aborts a running session remotely", async () => {
    const slowAdapter = new MockAgentAdapter({ seedSession: true, stepMs: 120 })
    await slowAdapter.start()
    const conn = new RelayConnection({
      relayUrl: `ws://127.0.0.1:${port}`,
      adapter: slowAdapter,
      store: new HostStore(":memory:"),
      deviceId: "host-2",
      pairingToken: "stop-token",
      hostInfo: () => ({
        deviceId: "host-2",
        name: "stop-mac",
        online: true,
        adapter: "mock",
        activeSessions: 1,
      }),
    })
    conn.start()
    await new Promise((r) => setTimeout(r, 150))

    const client = new TestClient(`ws://127.0.0.1:${port}/client`)
    await client.open()
    client.pair("stop-token")
    await new Promise((r) => setTimeout(r, 80))

    client.command({ type: "prompt.send", sessionId: "mock-session-1", text: "long task" })
    await new Promise((r) => setTimeout(r, 200))
    client.command({ type: "session.abort", sessionId: "mock-session-1" })

    await client.waitForEvent((types) => types.includes("agent.completed"))
    expect(client.events.map((e) => e.event.type)).toContain("agent.completed")

    client.close()
    conn.stop()
    await slowAdapter.stop()
  })

  test("permission request reaches browser; allow flows back and resumes (milestone 2)", async () => {
    const permAdapter = new MockAgentAdapter({ seedSession: true, stepMs: 10 })
    await permAdapter.start()
    const conn = new RelayConnection({
      relayUrl: `ws://127.0.0.1:${port}`,
      adapter: permAdapter,
      store: new HostStore(":memory:"),
      deviceId: "host-3",
      pairingToken: "perm-token",
      hostInfo: () => ({
        deviceId: "host-3",
        name: "perm-mac",
        online: true,
        adapter: "mock",
        activeSessions: 1,
      }),
    })
    conn.start()
    await new Promise((r) => setTimeout(r, 150))

    const client = new TestClient(`ws://127.0.0.1:${port}/client`)
    await client.open()
    client.pair("perm-token")
    await new Promise((r) => setTimeout(r, 80))

    client.command({
      type: "prompt.send",
      sessionId: "mock-session-1",
      text: "ask permission before running tests",
    })

    await client.waitForEvent((types) => types.includes("permission.requested"))
    const req = client.events.find((e) => e.event.type === "permission.requested")
    const permissionId =
      req && req.event.type === "permission.requested" ? req.event.permissionId : ""
    expect(permissionId).not.toBe("")

    client.command({
      type: "permission.respond",
      sessionId: "mock-session-1",
      permissionId,
      response: "allow",
    })

    await client.waitForEvent((types) => types.includes("agent.completed"))
    const types = client.events.map((e) => e.event.type)
    expect(types).toContain("permission.resolved")
    expect(types).toContain("terminal.output")
    expect(types).toContain("agent.completed")

    client.close()
    conn.stop()
    await permAdapter.stop()
  })

  test("duplicate command delivery is a no-op (idempotency)", async () => {
    const dupAdapter = new MockAgentAdapter({ seedSession: true, stepMs: 10 })
    await dupAdapter.start()
    const conn = new RelayConnection({
      relayUrl: `ws://127.0.0.1:${port}`,
      adapter: dupAdapter,
      store: new HostStore(":memory:"),
      deviceId: "host-dup",
      pairingToken: "dup-token",
      hostInfo: () => ({
        deviceId: "host-dup",
        name: "dup-mac",
        online: true,
        adapter: "mock",
        activeSessions: 1,
      }),
    })
    conn.start()
    await new Promise((r) => setTimeout(r, 150))

    const client = new TestClient(`ws://127.0.0.1:${port}/client`)
    await client.open()
    client.pair("dup-token")
    await new Promise((r) => setTimeout(r, 80))

    // Send the SAME command (same messageId) twice — a redelivery.
    const messageId = "dup-msg-1"
    const cmd: RemoteCommand = {
      type: "prompt.send",
      sessionId: "mock-session-1",
      text: "do the thing",
    }
    client.commandWithId(cmd, messageId)
    client.commandWithId(cmd, messageId)

    await client.waitForEvent((types) => types.includes("agent.completed"))
    await new Promise((r) => setTimeout(r, 60))

    // Exactly one run should have executed despite the duplicate delivery.
    const runStarts = client.events.filter((e) => e.event.type === "run.started").length
    const completes = client.events.filter((e) => e.event.type === "agent.completed").length
    expect(runStarts).toBe(1)
    expect(completes).toBe(1)

    client.close()
    conn.stop()
    await dupAdapter.stop()
  })
})
