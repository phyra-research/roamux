import { describe, expect, test } from "bun:test"
import { MockAgentAdapter } from "@openremote/agent-adapters"
import type { RemoteCommand } from "@openremote/protocol"
import { handleCommand } from "./command-handler.js"
import { HostSessionManager } from "./host-session-manager.js"
import { HostStore } from "./store.js"

/** A manager backed by an in-memory store with a mock adapter + approved project. */
function makeManager(): {
  manager: HostSessionManager
  adapter: MockAgentAdapter
  store: HostStore
} {
  const store = new HostStore(":memory:")
  store.approveProject({ id: "proj_demo", label: "demo", absPath: "/tmp/demo" })
  const adapter = new MockAgentAdapter({ seedSession: true, stepMs: 5 })
  const manager = new HostSessionManager(store)
  manager.register(adapter)
  return { manager, adapter, store }
}

describe("handleCommand", () => {
  test("prompt.send forwards to the adapter", async () => {
    const { manager, adapter, store } = makeManager()
    const cmd: RemoteCommand = { type: "prompt.send", sessionId: "mock-session-1", text: "go" }
    expect(await handleCommand(manager, cmd)).toEqual([])
    await adapter.stop()
    store.close()
  })

  test("session.create validates + returns a fresh snapshot with the new session", async () => {
    const { manager, adapter, store } = makeManager()
    const before = (await manager.listSessions()).length
    const replies = await handleCommand(manager, {
      type: "session.create",
      projectId: "proj_demo",
      harnessType: "mock",
    })
    expect(replies.length).toBe(1)
    const snap = replies[0]
    expect(snap?.kind).toBe("sessions.snapshot")
    if (snap?.kind === "sessions.snapshot") {
      expect(snap.sessions.length).toBe(before + 1)
      expect(snap.sessions.some((s) => s.projectPath === "/tmp/demo")).toBe(true)
    }
    await adapter.stop()
    store.close()
  })

  test("session.create rejects an unapproved project", async () => {
    const { manager, adapter, store } = makeManager()
    await expect(
      handleCommand(manager, { type: "session.create", projectId: "nope", harnessType: "mock" }),
    ).rejects.toThrow(/not approved/)
    await adapter.stop()
    store.close()
  })

  test("session.create rejects an unavailable harness", async () => {
    const { manager, adapter, store } = makeManager()
    await expect(
      handleCommand(manager, {
        type: "session.create",
        projectId: "proj_demo",
        harnessType: "does-not-exist",
      }),
    ).rejects.toThrow(/not available/)
    await adapter.stop()
    store.close()
  })

  test("sessions.list returns a snapshot", async () => {
    const { manager, adapter, store } = makeManager()
    const replies = await handleCommand(manager, { type: "sessions.list" })
    expect(replies[0]?.kind).toBe("sessions.snapshot")
    await adapter.stop()
    store.close()
  })

  test("projects.list returns capabilities (approved project + installed harness)", async () => {
    const { manager, adapter, store } = makeManager()
    const replies = await handleCommand(manager, { type: "projects.list" })
    const snap = replies[0]
    expect(snap?.kind).toBe("projects.snapshot")
    if (snap?.kind === "projects.snapshot") {
      expect(snap.capabilities.projects.some((p) => p.id === "proj_demo")).toBe(true)
      expect(snap.capabilities.harnesses.some((h) => h.id === "mock")).toBe(true)
    }
    await adapter.stop()
    store.close()
  })

  test("diff.request returns a diff.snapshot event with the adapter's files", async () => {
    const { manager, adapter, store } = makeManager()
    adapter.seedDiff([
      { path: "src/x.ts", status: "modified", patch: "@@\n-a\n+b\n", additions: 1, deletions: 1 },
    ])
    const replies = await handleCommand(manager, {
      type: "diff.request",
      sessionId: "mock-session-1",
    })
    expect(replies.length).toBe(1)
    const reply = replies[0]
    expect(reply?.kind).toBe("event")
    if (reply?.kind === "event" && reply.event.type === "diff.snapshot") {
      expect(reply.event.files.map((f) => f.path)).toEqual(["src/x.ts"])
      expect(reply.event.error).toBeUndefined()
    }
    await adapter.stop()
    store.close()
  })

  test("diff.request surfaces an adapter failure as diff.snapshot with error", async () => {
    const { manager, adapter, store } = makeManager()
    adapter.seedDiffError("git not installed")
    const replies = await handleCommand(manager, {
      type: "diff.request",
      sessionId: "mock-session-1",
    })
    const reply = replies[0]
    if (reply?.kind === "event" && reply.event.type === "diff.snapshot") {
      expect(reply.event.files).toEqual([])
      expect(reply.event.error).toBe("git not installed")
    } else {
      throw new Error("expected a diff.snapshot event reply")
    }
    await adapter.stop()
    store.close()
  })

  test("session.abort and permission.respond do not throw", async () => {
    const { manager, adapter, store } = makeManager()
    await expect(
      handleCommand(manager, { type: "session.abort", sessionId: "mock-session-1" }),
    ).resolves.toEqual([])
    await expect(
      handleCommand(manager, {
        type: "permission.respond",
        sessionId: "mock-session-1",
        permissionId: "nope",
        response: "deny",
      }),
    ).resolves.toEqual([])
    await adapter.stop()
    store.close()
  })
})
