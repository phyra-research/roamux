import { describe, expect, test } from "bun:test"
import type { AgentEvent } from "@openremote/protocol"
import { RunTracker } from "./run-tracker.js"

/** Feed a sequence of events through one tracker; return the flat output types. */
function drive(events: [string, AgentEvent][]): { type: string; runId?: string }[] {
  const t = new RunTracker()
  const out: { type: string; runId?: string }[] = []
  for (const [sid, ev] of events) {
    for (const a of t.annotate(sid, ev)) out.push({ type: a.event.type, runId: a.runId })
  }
  return out
}

describe("RunTracker", () => {
  test("opens a run on first activity and closes on agent.completed", () => {
    const out = drive([
      ["s1", { type: "assistant.delta", text: "hi" }],
      ["s1", { type: "assistant.message", text: "hi there" }],
      ["s1", { type: "agent.completed" }],
    ])
    const types = out.map((o) => o.type)
    expect(types).toEqual([
      "run.started",
      "assistant.delta",
      "assistant.message",
      "agent.completed",
      "run.completed",
    ])
    // one stable runId across the whole run
    const runIds = new Set(out.map((o) => o.runId).filter(Boolean))
    expect(runIds.size).toBe(1)
  })

  test("agent.failed closes the run with run.failed carrying the error", () => {
    const out = drive([
      ["s1", { type: "session.started", sessionId: "s1" }],
      ["s1", { type: "agent.failed", error: "boom" }],
    ])
    const failed = out.find((o) => o.type === "run.failed")
    expect(failed).toBeDefined()
    expect(out.map((o) => o.type)).toEqual([
      "run.started",
      "session.started",
      "agent.failed",
      "run.failed",
    ])
  })

  test("a second prompt after completion opens a NEW run", () => {
    const t = new RunTracker()
    const first = t.annotate("s1", { type: "assistant.delta", text: "a" })
    t.annotate("s1", { type: "agent.completed" })
    const second = t.annotate("s1", { type: "assistant.delta", text: "b" })
    const firstRun = first[0]!.runId
    const secondRun = second.find((a) => a.event.type === "run.started")?.runId
    expect(secondRun).toBeDefined()
    expect(secondRun).not.toBe(firstRun)
  })

  test("runs are tracked independently per session", () => {
    const t = new RunTracker()
    const a = t.annotate("s1", { type: "assistant.delta", text: "x" })
    const b = t.annotate("s2", { type: "assistant.delta", text: "y" })
    expect(a[0]!.runId).not.toBe(b[0]!.runId)
  })

  test("does not synthesize a run for a bare terminal event with no open run", () => {
    // agent.completed with nothing open → just pass it through, no run.* events.
    const out = drive([["s1", { type: "agent.completed" }]])
    expect(out.map((o) => o.type)).toEqual(["agent.completed"])
  })
})
