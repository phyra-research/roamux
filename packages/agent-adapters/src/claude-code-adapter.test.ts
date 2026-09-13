import { describe, expect, test } from "bun:test"
import { ClaudeCodeAdapter, type ClaudeProc, type ClaudeSpawn } from "./claude-code-adapter.js"
import type { SessionEvent } from "./types.js"

/**
 * Unit tests for Claude Code CLI → OpenRemote normalization. No real `claude`
 * process ever runs — an injected `spawn` returns canned stream-json lines, and
 * `normalize` is exercised white-box (same approach as the OpenCode adapter).
 */

type FakeResponse = { lines?: string[]; exit?: number; stderr?: string; hang?: boolean }
type FakeProc = ClaudeProc & { args: string[]; killed: (string | undefined)[] }

function makeSpawn(respond: (args: string[]) => FakeResponse): {
  spawn: ClaudeSpawn
  procs: FakeProc[]
} {
  const procs: FakeProc[] = []
  const spawn: ClaudeSpawn = (args) => {
    const r = respond(args)
    const killed: (string | undefined)[] = []
    const proc: FakeProc = {
      args,
      killed,
      stdoutLines: (async function* () {
        for (const line of r.lines ?? []) yield line
      })(),
      stderr: Promise.resolve(r.stderr ?? ""),
      exited: r.hang ? new Promise<number>(() => {}) : Promise.resolve(r.exit ?? 0),
      kill: (signal) => killed.push(signal),
    }
    procs.push(proc)
    return proc
  }
  return { spawn, procs }
}

/** Feed one stream-json line straight into the private normalizer. */
function feeder(adapter: ClaudeCodeAdapter, sessionId = "s1") {
  return (raw: string) =>
    (adapter as unknown as { normalize: (s: string, r: string) => void }).normalize(sessionId, raw)
}

async function drain(
  adapter: ClaudeCodeAdapter,
  count: number,
  timeoutMs = 500,
): Promise<SessionEvent[]> {
  const out: SessionEvent[] = []
  const it = adapter.events()[Symbol.asyncIterator]()
  const deadline = Date.now() + timeoutMs
  while (out.length < count && Date.now() < deadline) {
    const next = await Promise.race([
      it.next(),
      new Promise<null>((r) => setTimeout(() => r(null), Math.max(0, deadline - Date.now()))),
    ])
    if (!next || next.done) break
    out.push(next.value)
  }
  return out
}

describe("ClaudeCodeAdapter.isInstalled", () => {
  test("false when `claude --version` fails", async () => {
    const { spawn } = makeSpawn(() => ({ exit: 127 }))
    expect(await new ClaudeCodeAdapter({ spawn }).isInstalled()).toBe(false)
  })

  test("false when installed but `auth status` is not logged in", async () => {
    const { spawn } = makeSpawn((args) =>
      args[0] === "auth" ? { lines: ['{"loggedIn":false}'] } : { exit: 0 },
    )
    expect(await new ClaudeCodeAdapter({ spawn }).isInstalled()).toBe(false)
  })

  test("true when installed and logged in", async () => {
    const { spawn } = makeSpawn((args) =>
      args[0] === "auth" ? { lines: ['{"loggedIn":true,"email":"x@y.z"}'] } : { exit: 0 },
    )
    expect(await new ClaudeCodeAdapter({ spawn }).isInstalled()).toBe(true)
  })
})

describe("ClaudeCodeAdapter.normalize", () => {
  test("text_delta stream_event → assistant.delta", async () => {
    const adapter = new ClaudeCodeAdapter()
    feeder(adapter)(
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } },
      }),
    )
    const [ev] = await drain(adapter, 1)
    expect(ev?.event).toEqual({ type: "assistant.delta", text: "hello" })
    await adapter.stop()
  })

  test("tool_use block → tool.started; matching tool_result → tool.completed", async () => {
    const adapter = new ClaudeCodeAdapter()
    const feed = feeder(adapter)
    feed(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }],
        },
      }),
    )
    feed(
      JSON.stringify({
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file.txt" }],
        },
      }),
    )
    const evs = await drain(adapter, 2)
    expect(evs[0]?.event).toEqual({
      type: "tool.started",
      tool: "Bash",
      callId: "toolu_1",
      input: { command: "ls" },
    })
    expect(evs[1]?.event).toEqual({
      type: "tool.completed",
      tool: "Bash",
      callId: "toolu_1",
      output: "file.txt",
    })
    await adapter.stop()
  })

  test("successful result → agent.completed", async () => {
    const adapter = new ClaudeCodeAdapter()
    feeder(adapter)(
      JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "OK" }),
    )
    const [ev] = await drain(adapter, 1)
    expect(ev?.event.type).toBe("agent.completed")
    await adapter.stop()
  })

  test("error result → agent.failed with the message", async () => {
    const adapter = new ClaudeCodeAdapter()
    feeder(adapter)(
      JSON.stringify({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        result: "boom",
      }),
    )
    const [ev] = await drain(adapter, 1)
    expect(ev?.event).toEqual({ type: "agent.failed", error: "boom" })
    await adapter.stop()
  })

  test("system/init and rate_limit_event are ignored", async () => {
    const adapter = new ClaudeCodeAdapter()
    const feed = feeder(adapter)
    feed(JSON.stringify({ type: "system", subtype: "init", session_id: "x" }))
    feed(JSON.stringify({ type: "rate_limit_event", rate_limit_info: {} }))
    feed(JSON.stringify({ type: "result", subtype: "success", is_error: false }))
    const evs = await drain(adapter, 3, 200)
    expect(evs.map((e) => e.event.type)).toEqual(["agent.completed"])
    await adapter.stop()
  })
})

describe("ClaudeCodeAdapter run lifecycle", () => {
  test("sendPrompt streams normalized events then completes on exit 0", async () => {
    const { spawn, procs } = makeSpawn((args) =>
      args[0] === "-p"
        ? {
            lines: [
              JSON.stringify({ type: "system", subtype: "init" }),
              JSON.stringify({
                type: "stream_event",
                event: { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } },
              }),
              JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "hi" }),
            ],
            exit: 0,
          }
        : { exit: 0 },
    )
    const adapter = new ClaudeCodeAdapter({ spawn, cwd: "/tmp/proj" })
    const session = await adapter.createSession("/tmp/proj")
    await adapter.sendPrompt(session.id, "hi")

    const types = (await drain(adapter, 4)).map((e) => e.event.type)
    expect(types).toContain("assistant.delta")
    expect(types).toContain("agent.completed")
    // Turn 0 pins the session id.
    expect(procs[0]?.args.slice(0, 4)).toEqual(["-p", "hi", "--session-id", session.id])
    await adapter.stop()
  })

  test("second turn resumes the same session id", async () => {
    const { spawn, procs } = makeSpawn(() => ({
      lines: [JSON.stringify({ type: "result", subtype: "success", is_error: false })],
      exit: 0,
    }))
    const adapter = new ClaudeCodeAdapter({ spawn })
    const s = await adapter.createSession("/tmp/p")
    await adapter.sendPrompt(s.id, "one")
    await drain(adapter, 2)
    await adapter.sendPrompt(s.id, "two")
    await drain(adapter, 1)
    expect(procs[1]?.args.slice(0, 4)).toEqual(["-p", "two", "--resume", s.id])
    await adapter.stop()
  })

  test("non-zero exit with no result surfaces agent.failed with stderr", async () => {
    const { spawn } = makeSpawn((args) =>
      args[0] === "-p" ? { lines: [], exit: 1, stderr: "not authenticated\n" } : { exit: 0 },
    )
    const adapter = new ClaudeCodeAdapter({ spawn })
    const s = await adapter.createSession("/tmp/p")
    await adapter.sendPrompt(s.id, "hi")
    const evs = await drain(adapter, 2)
    const failed = evs.find((e) => e.event.type === "agent.failed")
    expect(failed?.event).toEqual({ type: "agent.failed", error: "not authenticated" })
    await adapter.stop()
  })

  test("abortSession SIGTERMs the running process", async () => {
    const { spawn, procs } = makeSpawn((args) => (args[0] === "-p" ? { hang: true } : { exit: 0 }))
    const adapter = new ClaudeCodeAdapter({ spawn })
    const s = await adapter.createSession("/tmp/p")
    await adapter.sendPrompt(s.id, "long task")
    await adapter.abortSession(s.id)
    expect(procs[0]?.killed).toContain("SIGTERM")
    await adapter.stop()
  })
})
