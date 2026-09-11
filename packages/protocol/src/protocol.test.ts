import { describe, expect, test } from "bun:test"
import {
  AgentEventSchema,
  ClientToRelayEnvelopeSchema,
  HostToRelayEnvelopeSchema,
  PROTOCOL_VERSION,
  RelayToClientEnvelopeSchema,
  RemoteCommandSchema,
  createEnvelope,
  newId,
  newPairingToken,
  parseWith,
  serialize,
} from "./index.js"

describe("ids", () => {
  test("newId is unique-ish and non-empty", () => {
    expect(newId()).not.toEqual(newId())
    expect(newId().length).toBeGreaterThan(0)
  })

  test("newId is a valid UUIDv4", () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  test("pairing token is 12 hex chars", () => {
    const t = newPairingToken()
    expect(t).toMatch(/^[0-9a-f]{12}$/)
  })

  test("newId still works when crypto.randomUUID is unavailable (insecure LAN-IP origin)", () => {
    // Simulate a browser served over http://<ip> where randomUUID is hidden but
    // getRandomValues is still present — the exact case that broke the demo.
    const original = globalThis.crypto.randomUUID
    try {
      // @ts-expect-error deliberately removing for the test
      globalThis.crypto.randomUUID = undefined
      const id = newId()
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    } finally {
      globalThis.crypto.randomUUID = original
    }
  })
})

describe("envelope round-trip", () => {
  test("command envelope serializes and re-parses", () => {
    const env = createEnvelope(
      {
        kind: "command" as const,
        command: { type: "prompt.send" as const, sessionId: "s1", text: "hi" },
      },
      { deviceId: "dev-1", sessionId: "s1" },
    )
    const wire = serialize(env)
    const parsed = parseWith(ClientToRelayEnvelopeSchema, wire)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.protocolVersion).toBe(PROTOCOL_VERSION)
      expect(parsed.value.message.kind).toBe("command")
    }
  })

  test("diff.request command round-trips", () => {
    const env = createEnvelope(
      { kind: "command" as const, command: { type: "diff.request" as const, sessionId: "s1" } },
      { deviceId: "dev-1", sessionId: "s1" },
    )
    const parsed = parseWith(ClientToRelayEnvelopeSchema, serialize(env))
    expect(parsed.ok).toBe(true)
    if (parsed.ok && parsed.value.message.kind === "command") {
      expect(parsed.value.message.command.type).toBe("diff.request")
    }
  })

  test("diff.snapshot event round-trips (with and without error)", () => {
    const withFiles = createEnvelope(
      {
        kind: "event" as const,
        event: {
          type: "diff.snapshot" as const,
          files: [
            {
              path: "src/a.ts",
              status: "modified" as const,
              patch: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
              additions: 1,
              deletions: 1,
            },
          ],
        },
      },
      { deviceId: "dev-1", sessionId: "s1" },
    )
    const p1 = parseWith(HostToRelayEnvelopeSchema, serialize(withFiles))
    expect(p1.ok).toBe(true)
    if (
      p1.ok &&
      p1.value.message.kind === "event" &&
      p1.value.message.event.type === "diff.snapshot"
    ) {
      expect(p1.value.message.event.files[0]?.path).toBe("src/a.ts")
    }

    const withError = createEnvelope(
      {
        kind: "event" as const,
        event: { type: "diff.snapshot" as const, files: [], error: "git not found" },
      },
      { deviceId: "dev-1", sessionId: "s1" },
    )
    const p2 = parseWith(HostToRelayEnvelopeSchema, serialize(withError))
    expect(p2.ok).toBe(true)
    if (
      p2.ok &&
      p2.value.message.kind === "event" &&
      p2.value.message.event.type === "diff.snapshot"
    ) {
      expect(p2.value.message.event.error).toBe("git not found")
      expect(p2.value.message.event.files).toEqual([])
    }
  })

  test("event envelope carries a sequence number", () => {
    const env = createEnvelope(
      { kind: "event" as const, event: { type: "assistant.delta" as const, text: "chunk" } },
      { deviceId: "dev-1", sessionId: "s1", sequence: 42 },
    )
    const parsed = parseWith(HostToRelayEnvelopeSchema, serialize(env))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.sequence).toBe(42)
  })

  test("envelope carries beta routing fields hostId + runId", () => {
    const env = createEnvelope(
      { kind: "event" as const, event: { type: "assistant.delta" as const, text: "chunk" } },
      { deviceId: "dev-1", hostId: "host-abc", sessionId: "s1", runId: "run-9", sequence: 7 },
    )
    expect(env.hostId).toBe("host-abc")
    expect(env.runId).toBe("run-9")
    const parsed = parseWith(HostToRelayEnvelopeSchema, serialize(env))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.hostId).toBe("host-abc")
      expect(parsed.value.runId).toBe("run-9")
    }
  })

  test("hostId + runId are optional — V0 envelopes still validate", () => {
    const env = createEnvelope({ kind: "ack" as const, ok: true }, { deviceId: "d" })
    expect(env.hostId).toBeUndefined()
    expect(env.runId).toBeUndefined()
    const parsed = parseWith(RelayToClientEnvelopeSchema, serialize(env))
    expect(parsed.ok).toBe(true)
  })
})

describe("parse hardening", () => {
  test("rejects invalid JSON without throwing", () => {
    const r = parseWith(ClientToRelayEnvelopeSchema, "{not json")
    expect(r.ok).toBe(false)
  })

  test("rejects wrong protocol version", () => {
    const bad = { ...createEnvelope({ kind: "ack" }, { deviceId: "d" }), protocolVersion: 99 }
    const r = parseWith(HostToRelayEnvelopeSchema, JSON.stringify(bad))
    expect(r.ok).toBe(false)
  })

  test("rejects unknown command type", () => {
    const r = RemoteCommandSchema.safeParse({ type: "shell.exec", cmd: "rm -rf /" })
    expect(r.success).toBe(false)
  })

  test("rejects empty prompt text", () => {
    const r = RemoteCommandSchema.safeParse({ type: "prompt.send", sessionId: "s", text: "" })
    expect(r.success).toBe(false)
  })
})

describe("agent events", () => {
  test("all documented event types validate", () => {
    const samples = [
      { type: "session.started", sessionId: "s" },
      { type: "assistant.delta", text: "x" },
      { type: "assistant.message", text: "x" },
      { type: "tool.started", tool: "bash" },
      { type: "tool.completed", tool: "bash" },
      { type: "terminal.output", text: "out" },
      { type: "file.changed", path: "src/a.ts" },
      {
        type: "diff.snapshot",
        files: [{ path: "a.ts", status: "added", patch: "+x\n", additions: 1, deletions: 0 }],
      },
      { type: "diff.snapshot", files: [], error: "boom" },
      { type: "permission.requested", permissionId: "p", description: "run rm" },
      { type: "permission.resolved", permissionId: "p", response: "allow" },
      { type: "agent.waiting" },
      { type: "agent.completed" },
      { type: "agent.failed", error: "boom" },
    ]
    for (const s of samples) {
      expect(AgentEventSchema.safeParse(s).success).toBe(true)
    }
  })

  test("diff.snapshot rejects a bad status and negative counts", () => {
    expect(
      AgentEventSchema.safeParse({
        type: "diff.snapshot",
        files: [{ path: "a", status: "renamed", patch: "", additions: 0, deletions: 0 }],
      }).success,
    ).toBe(false)
    expect(
      AgentEventSchema.safeParse({
        type: "diff.snapshot",
        files: [{ path: "a", status: "added", patch: "", additions: -1, deletions: 0 }],
      }).success,
    ).toBe(false)
  })

  test("permission response must be allow|deny", () => {
    expect(
      AgentEventSchema.safeParse({
        type: "permission.resolved",
        permissionId: "p",
        response: "maybe",
      }).success,
    ).toBe(false)
  })
})
