import { describe, expect, test } from "bun:test"
import type { AgentEvent } from "@openremote/protocol"
import { MockAgentAdapter } from "./mock-adapter.js"
import type { SessionEvent } from "./types.js"

/** Collect events until a predicate is satisfied or a timeout elapses. */
async function collectUntil(
  adapter: MockAgentAdapter,
  done: (types: AgentEvent["type"][]) => boolean,
  timeoutMs = 4000,
): Promise<SessionEvent[]> {
  const collected: SessionEvent[] = []
  const iterator = adapter.events()[Symbol.asyncIterator]()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const next = await Promise.race([
      iterator.next(),
      new Promise<null>((r) => setTimeout(() => r(null), deadline - Date.now())),
    ])
    if (!next || next.done) break
    collected.push(next.value)
    if (done(collected.map((c) => c.event.type))) break
  }
  return collected
}

describe("MockAgentAdapter", () => {
  test("seeds a session and lists it", async () => {
    const a = new MockAgentAdapter({ seedSession: true })
    const sessions = await a.listSessions()
    expect(sessions.length).toBe(1)
    expect(sessions[0]?.title).toBe("my-project")
    await a.stop()
  })

  test("createSession emits session.started", async () => {
    const a = new MockAgentAdapter({ seedSession: false, stepMs: 5 })
    const collected = collectUntil(a, (t) => t.includes("session.started"))
    const s = await a.createSession("/tmp/demo")
    expect(s.projectPath).toBe("/tmp/demo")
    const events = await collected
    expect(events.some((e) => e.event.type === "session.started")).toBe(true)
    await a.stop()
  })

  test("a normal prompt streams deltas, tools, message, completion", async () => {
    const a = new MockAgentAdapter({ seedSession: true, stepMs: 5 })
    const collected = collectUntil(a, (t) => t.includes("agent.completed"))
    await a.sendPrompt("mock-session-1", "Inspect this repository and tell me what it does.")
    const types = (await collected).map((e) => e.event.type)
    expect(types).toContain("tool.started")
    expect(types).toContain("tool.completed")
    expect(types).toContain("assistant.delta")
    expect(types).toContain("assistant.message")
    expect(types).toContain("agent.completed")
    await a.stop()
  })

  test("prompt with 'permission' pauses and resumes on allow", async () => {
    const a = new MockAgentAdapter({ seedSession: true, stepMs: 5 })
    // Watch for the permission request first.
    const untilPermission = collectUntil(a, (t) => t.includes("permission.requested"))
    await a.sendPrompt("mock-session-1", "please ask permission before running tests")
    const pre = await untilPermission
    const req = pre.find((e) => e.event.type === "permission.requested")
    expect(req).toBeDefined()
    const permissionId =
      req && req.event.type === "permission.requested" ? req.event.permissionId : ""
    expect(permissionId).not.toBe("")

    // Now allow and confirm the run completes with terminal output.
    const untilDone = collectUntil(a, (t) => t.includes("agent.completed"))
    await a.respondToPermission("mock-session-1", permissionId, "allow")
    const post = (await untilDone).map((e) => e.event.type)
    expect(post).toContain("permission.resolved")
    expect(post).toContain("terminal.output")
    expect(post).toContain("agent.completed")
    await a.stop()
  })

  test("abort stops the run", async () => {
    const a = new MockAgentAdapter({ seedSession: true, stepMs: 60 })
    const collected = collectUntil(a, (t) => t.includes("agent.completed"))
    await a.sendPrompt("mock-session-1", "long task")
    await new Promise((r) => setTimeout(r, 80))
    await a.abortSession("mock-session-1")
    const types = (await collected).map((e) => e.event.type)
    expect(types).toContain("agent.completed")
    await a.stop()
  })
})
