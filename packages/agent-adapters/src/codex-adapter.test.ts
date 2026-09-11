import { describe, expect, test } from "bun:test"
import { CodexAdapter, type CodexProc, type CodexSpawn } from "./codex-adapter.js"
import type { SessionEvent } from "./types.js"

/**
 * Unit tests for Codex CLI → OpenRemote normalization. No real `codex` process
 * ever runs — an injected `spawn` returns canned stream-json lines, and
 * `normalize` is exercised white-box (same approach as the other adapters).
 */

type FakeResponse = { lines?: string[]; exit?: number; stderr?: string; hang?: boolean }
type FakeProc = CodexProc & { args: string[]; killed: (string | undefined)[] }

function makeSpawn(respond: (args: string[]) => FakeResponse): {
  spawn: CodexSpawn
  procs: FakeProc[]
} {
  const procs: FakeProc[] = []
  const spawn: CodexSpawn = (args) => {
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
function feeder(adapter: CodexAdapter, rec: { id: string } = { id: "s1" }) {
  return (raw: string) =>
    (adapter as unknown as { normalize: (r: { id: string }, raw: string) => void }).normalize(
      rec,
      raw,
    )
}

async function drain(
  adapter: CodexAdapter,
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

describe("CodexAdapter.isInstalled", () => {
  test("false when `codex --version` fails", async () => {
    const { spawn } = makeSpawn(() => ({ exit: 127 }))
    expect(await new CodexAdapter({ spawn }).isInstalled()).toBe(false)
  })

  test("false when installed but `login status` is not logged in", async () => {
    const { spawn } = makeSpawn((args) =>
      args[0] === "login" ? { lines: ["Not logged in"] } : { exit: 0 },
    )
    expect(await new CodexAdapter({ spawn }).isInstalled()).toBe(false)
  })

  test("true when installed and logged in", async () => {
    const { spawn } = makeSpawn((args) =>
      args[0] === "login" ? { lines: ["Logged in using ChatGPT"] } : { exit: 0 },
    )
    expect(await new CodexAdapter({ spawn }).isInstalled()).toBe(true)
  })
})

describe("CodexAdapter.normalize", () => {
  test("thread.started records the real Codex thread id (no event emitted)", async () => {
    const adapter = new CodexAdapter()
    const rec = { id: "s1", codexThreadId: undefined as string | undefined }
    feeder(adapter, rec)(JSON.stringify({ type: "thread.started", thread_id: "cx-abc" }))
    expect(rec.codexThreadId).toBe("cx-abc")
    const evs = await drain(adapter, 1, 100)
    expect(evs).toEqual([])
    await adapter.stop()
  })

  test("item.completed agent_message → assistant.message (no delta faking)", async () => {
    const adapter = new CodexAdapter()
    feeder(adapter)(
      JSON.stringify({
        type: "item.completed",
        item: { id: "item_0", type: "agent_message", text: "hello" },
      }),
    )
    const [ev] = await drain(adapter, 1)
    expect(ev?.event).toEqual({ type: "assistant.message", text: "hello" })
    await adapter.stop()
  })

  test("command_execution: item.started → tool.started, item.completed → tool.completed", async () => {
    const adapter = new CodexAdapter()
    const feed = feeder(adapter)
    feed(
      JSON.stringify({
        type: "item.started",
        item: {
          id: "item_1",
          type: "command_execution",
          command: "echo hi",
          status: "in_progress",
        },
      }),
    )
    feed(
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_1",
          type: "command_execution",
          command: "echo hi",
          aggregated_output: "hi\n",
          exit_code: 0,
          status: "completed",
        },
      }),
    )
    const evs = await drain(adapter, 2)
    expect(evs[0]?.event).toEqual({
      type: "tool.started",
      tool: "command_execution",
      callId: "item_1",
      input: { command: "echo hi" },
    })
    expect(evs[1]?.event).toEqual({
      type: "tool.completed",
      tool: "command_execution",
      callId: "item_1",
      output: "hi\n",
    })
    await adapter.stop()
  })

  test("turn.completed → agent.completed", async () => {
    const adapter = new CodexAdapter()
    feeder(adapter)(JSON.stringify({ type: "turn.completed", usage: {} }))
    const [ev] = await drain(adapter, 1)
    expect(ev?.event.type).toBe("agent.completed")
    await adapter.stop()
  })

  test("turn.started and unknown lines are ignored", async () => {
    const adapter = new CodexAdapter()
    const feed = feeder(adapter)
    feed(JSON.stringify({ type: "turn.started" }))
    feed(JSON.stringify({ type: "something.unmapped", foo: "bar" }))
    feed(JSON.stringify({ type: "turn.completed" }))
    const evs = await drain(adapter, 2, 200)
    expect(evs.map((e) => e.event.type)).toEqual(["agent.completed"])
    await adapter.stop()
  })
})

describe("CodexAdapter run lifecycle", () => {
  test("sendPrompt streams normalized events then completes on exit 0", async () => {
    const { spawn, procs } = makeSpawn((args) =>
      args[0] === "exec"
        ? {
            lines: [
              JSON.stringify({ type: "thread.started", thread_id: "cx-1" }),
              JSON.stringify({ type: "turn.started" }),
              JSON.stringify({
                type: "item.completed",
                item: { id: "item_0", type: "agent_message", text: "hi" },
              }),
              JSON.stringify({ type: "turn.completed", usage: {} }),
            ],
            exit: 0,
          }
        : { exit: 0 },
    )
    const adapter = new CodexAdapter({ spawn, cwd: "/tmp/proj" })
    const session = await adapter.createSession("/tmp/proj")
    await adapter.sendPrompt(session.id, "hi")

    const types = (await drain(adapter, 3)).map((e) => e.event.type)
    expect(types).toContain("assistant.message")
    expect(types).toContain("agent.completed")
    // First turn: no -C-equivalent id yet — plain `exec`, not `exec resume`.
    expect(procs[0]?.args).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-s",
      "workspace-write",
      "hi",
    ])
    await adapter.stop()
  })

  test("second turn resumes the real Codex thread id (different flags than turn 1)", async () => {
    const { spawn, procs } = makeSpawn(() => ({
      lines: [
        JSON.stringify({ type: "thread.started", thread_id: "cx-42" }),
        JSON.stringify({ type: "turn.completed" }),
      ],
      exit: 0,
    }))
    const adapter = new CodexAdapter({ spawn })
    const s = await adapter.createSession("/tmp/p")
    await adapter.sendPrompt(s.id, "one")
    await drain(adapter, 1)
    await adapter.sendPrompt(s.id, "two")
    await drain(adapter, 1)
    expect(procs[1]?.args).toEqual([
      "exec",
      "resume",
      "cx-42",
      "--json",
      "--skip-git-repo-check",
      "two",
    ])
    await adapter.stop()
  })

  test("non-zero exit with no terminal event surfaces agent.failed with stderr", async () => {
    const { spawn } = makeSpawn((args) =>
      args[0] === "exec"
        ? { lines: [], exit: 1, stderr: "Error: not authenticated\n" }
        : { exit: 0 },
    )
    const adapter = new CodexAdapter({ spawn })
    const s = await adapter.createSession("/tmp/p")
    await adapter.sendPrompt(s.id, "hi")
    const evs = await drain(adapter, 2)
    const failed = evs.find((e) => e.event.type === "agent.failed")
    expect(failed?.event).toEqual({ type: "agent.failed", error: "Error: not authenticated" })
    await adapter.stop()
  })

  test("abortSession SIGTERMs the running process", async () => {
    const { spawn, procs } = makeSpawn((args) =>
      args[0] === "exec" ? { hang: true } : { exit: 0 },
    )
    const adapter = new CodexAdapter({ spawn })
    const s = await adapter.createSession("/tmp/p")
    await adapter.sendPrompt(s.id, "long task")
    await adapter.abortSession(s.id)
    expect(procs[0]?.killed).toContain("SIGTERM")
    await adapter.stop()
  })
})
