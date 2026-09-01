import { describe, expect, test } from "bun:test"
import { MockAgentAdapter } from "@openremote/agent-adapters"
import type { RemoteCommand } from "@openremote/protocol"
import { handleCommand } from "./command-handler.js"

describe("handleCommand", () => {
  test("prompt.send forwards to the adapter", async () => {
    const adapter = new MockAgentAdapter({ seedSession: true, stepMs: 5 })
    const cmd: RemoteCommand = { type: "prompt.send", sessionId: "mock-session-1", text: "go" }
    const replies = await handleCommand(adapter, cmd)
    expect(replies).toEqual([])
    await adapter.stop()
  })

  test("session.create returns a fresh snapshot including the new session", async () => {
    const adapter = new MockAgentAdapter({ seedSession: true, stepMs: 5 })
    const before = (await adapter.listSessions()).length
    const replies = await handleCommand(adapter, {
      type: "session.create",
      projectPath: "/tmp/new-proj",
    })
    expect(replies.length).toBe(1)
    const snap = replies[0]
    expect(snap?.kind).toBe("sessions.snapshot")
    if (snap?.kind === "sessions.snapshot") {
      expect(snap.sessions.length).toBe(before + 1)
      expect(snap.sessions.some((s) => s.projectPath === "/tmp/new-proj")).toBe(true)
    }
    await adapter.stop()
  })

  test("sessions.list returns a snapshot", async () => {
    const adapter = new MockAgentAdapter({ seedSession: true, stepMs: 5 })
    const replies = await handleCommand(adapter, { type: "sessions.list" })
    expect(replies[0]?.kind).toBe("sessions.snapshot")
    await adapter.stop()
  })

  test("session.abort and permission.respond do not throw", async () => {
    const adapter = new MockAgentAdapter({ seedSession: true, stepMs: 5 })
    await expect(
      handleCommand(adapter, { type: "session.abort", sessionId: "mock-session-1" }),
    ).resolves.toEqual([])
    await expect(
      handleCommand(adapter, {
        type: "permission.respond",
        sessionId: "mock-session-1",
        permissionId: "nope",
        response: "deny",
      }),
    ).resolves.toEqual([])
    await adapter.stop()
  })
})
