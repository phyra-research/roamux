import { describe, expect, test } from "bun:test"
import { OpenCodeAdapter } from "./opencode-adapter.js"
import type { SessionEvent } from "./types.js"

/**
 * Unit tests for OpenCode → OpenRemote event normalization. We don't need a live
 * server: we construct the adapter (it won't connect until start()) and feed raw
 * OpenCode events straight into the private `normalize` method, draining the
 * resulting normalized events off the public stream.
 */
function makeAdapter() {
  const adapter = new OpenCodeAdapter({ baseUrl: "http://127.0.0.1:1", directory: "/tmp" })
  // Access the private normalize + queue for white-box testing.
  const feed = (event: unknown) =>
    (adapter as unknown as { normalize: (e: unknown) => void }).normalize(event)
  return { adapter, feed }
}

async function drain(
  adapter: OpenCodeAdapter,
  count: number,
  timeoutMs = 500,
): Promise<SessionEvent[]> {
  const out: SessionEvent[] = []
  const it = adapter.events()[Symbol.asyncIterator]()
  const deadline = Date.now() + timeoutMs
  while (out.length < count && Date.now() < deadline) {
    const next = await Promise.race([
      it.next(),
      new Promise<null>((r) => setTimeout(() => r(null), deadline - Date.now())),
    ])
    if (!next || next.done) break
    out.push(next.value)
  }
  return out
}

describe("OpenCodeAdapter.normalize", () => {
  test("explicit delta → assistant.delta", async () => {
    const { adapter, feed } = makeAdapter()
    feed({
      type: "message.part.updated",
      properties: {
        part: { type: "text", sessionID: "s1", id: "p1", messageID: "m1" },
        delta: "hello",
      },
    })
    const [ev] = await drain(adapter, 1)
    expect(ev?.event).toEqual({ type: "assistant.delta", text: "hello" })
    await adapter.stop()
  })

  test("full running text (no delta) → suffix diffs as assistant.delta", async () => {
    const { adapter, feed } = makeAdapter()
    // This OpenCode build sends the growing full text, no `delta` field.
    feed({
      type: "message.part.updated",
      properties: {
        part: { type: "text", sessionID: "s1", id: "p1", messageID: "m1", text: "One" },
      },
    })
    feed({
      type: "message.part.updated",
      properties: {
        part: { type: "text", sessionID: "s1", id: "p1", messageID: "m1", text: "One, two" },
      },
    })
    const evs = await drain(adapter, 2)
    expect(evs.map((e) => (e.event.type === "assistant.delta" ? e.event.text : ""))).toEqual([
      "One",
      ", two",
    ])
    await adapter.stop()
  })

  test("user-echo text is NOT streamed as assistant output", async () => {
    const { adapter, feed } = makeAdapter()
    // Learn that m-user is the user's message.
    feed({ type: "message.updated", properties: { info: { id: "m-user", role: "user" } } })
    feed({ type: "message.updated", properties: { info: { id: "m-asst", role: "assistant" } } })
    // User's echoed prompt — must be ignored.
    feed({
      type: "message.part.updated",
      properties: {
        part: { type: "text", sessionID: "s1", id: "pu", messageID: "m-user", text: "my prompt" },
      },
    })
    // Assistant's reply — must stream.
    feed({
      type: "message.part.updated",
      properties: {
        part: { type: "text", sessionID: "s1", id: "pa", messageID: "m-asst", text: "the answer" },
      },
    })
    const [ev] = await drain(adapter, 1)
    expect(ev?.event).toEqual({ type: "assistant.delta", text: "the answer" })
    await adapter.stop()
  })

  test("running tool → tool.started, completed tool → tool.completed", async () => {
    const { adapter, feed } = makeAdapter()
    feed({
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          sessionID: "s1",
          tool: "bash",
          callID: "c1",
          state: { status: "running", input: { command: "ls" } },
        },
      },
    })
    feed({
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          sessionID: "s1",
          tool: "bash",
          callID: "c1",
          state: { status: "completed", output: "file.txt" },
        },
      },
    })
    const evs = await drain(adapter, 2)
    expect(evs[0]?.event.type).toBe("tool.started")
    expect(evs[1]?.event.type).toBe("tool.completed")
    await adapter.stop()
  })

  test("session.error surfaces agent.failed with the API message", async () => {
    const { adapter, feed } = makeAdapter()
    feed({
      type: "session.error",
      properties: {
        sessionID: "s1",
        error: { name: "APIError", data: { message: "anthropic-workspace-id is required" } },
      },
    })
    const [ev] = await drain(adapter, 1)
    expect(ev?.event.type).toBe("agent.failed")
    if (ev?.event.type === "agent.failed") {
      expect(ev.event.error).toContain("anthropic-workspace-id")
    }
    await adapter.stop()
  })

  test("a session.idle right after an error does NOT emit a masking agent.completed", async () => {
    const { adapter, feed } = makeAdapter()
    feed({
      type: "session.error",
      properties: { sessionID: "s1", error: { data: { message: "boom" } } },
    })
    feed({ type: "session.idle", properties: { sessionID: "s1" } })
    // The next real idle (a later, successful run) SHOULD complete normally.
    feed({ type: "session.idle", properties: { sessionID: "s1" } })

    const evs = await drain(adapter, 3, 400)
    const types = evs.map((e) => e.event.type)
    // First: the failure. The immediately-following idle is suppressed. The
    // subsequent idle completes.
    expect(types[0]).toBe("agent.failed")
    expect(types).toContain("agent.completed")
    // Exactly one completed, and it is NOT adjacent-masking the error.
    expect(types.filter((t) => t === "agent.completed").length).toBe(1)
    await adapter.stop()
  })

  test("session.idle for a clean run emits agent.completed", async () => {
    const { adapter, feed } = makeAdapter()
    feed({ type: "session.idle", properties: { sessionID: "s2" } })
    const [ev] = await drain(adapter, 1)
    expect(ev?.event.type).toBe("agent.completed")
    await adapter.stop()
  })
})
