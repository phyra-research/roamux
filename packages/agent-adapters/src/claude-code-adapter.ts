import type { AgentSession, DiffSnapshot } from "@openremote/protocol"
import { EventQueue } from "./event-queue.js"
import { readGitWorkingTree } from "./git-diff.js"
import type { HarnessAdapter, SessionEvent } from "./types.js"

/**
 * ClaudeCodeAdapter — the ONLY place Claude Code CLI (`claude`) specifics may
 * live (CLAUDE.md §2). It maps the CLI's `--output-format stream-json` NDJSON to
 * the OpenRemote vocabulary.
 *
 * Unlike OpenCode (one long-lived `opencode serve`, many sessions), Claude Code
 * print mode is one subprocess PER PROMPT: `claude -p <text> --session-id <uuid>`
 * on the first turn, `--resume <uuid>` after. That's the whole reason this
 * adapter exists as the #60 pilot — same HarnessAdapter contract, wildly
 * different runtime shape.
 *
 * SECURITY (CLAUDE.md §3): no shell (argv array), the prompt is one argv
 * element, and nothing raw off stdin/stdout/stderr reaches the wire — every line
 * is normalized to an AgentEvent here, same as OpenCode. Credentials are never
 * read; `claude` owns its own auth.
 */

/** How we spawn `claude`. Injected so tests never touch a real process. */
export type ClaudeSpawn = (args: string[], opts: { cwd?: string }) => ClaudeProc

export type ClaudeProc = {
  /** stdout, already split into lines (newline stripped). */
  stdoutLines: AsyncIterable<string>
  /** Full stderr text, resolved when the process exits. */
  stderr: Promise<string>
  /** Exit code. */
  exited: Promise<number>
  /** Signal the process. */
  kill: (signal?: NodeJS.Signals) => void
}

export type ClaudeCodeAdapterOptions = {
  /** Working directory for `claude` runs. Defaults to `process.cwd()`. */
  cwd?: string
  /** Test seam — defaults to a real `Bun.spawn(["claude", …])`. */
  spawn?: ClaudeSpawn
}

/** Common flags for every `claude -p` run. */
const STREAM_FLAGS = [
  "--output-format",
  "stream-json",
  "--include-partial-messages",
  "--verbose",
  "--permission-mode",
  "default",
]

type SessionRec = { id: string; cwd: string; turns: number }

export class ClaudeCodeAdapter implements HarnessAdapter {
  readonly id = "claude-code"
  readonly displayName = "Claude Code"
  /** @deprecated use `id` */
  readonly name = "claude-code"

  private readonly cwd: string
  private readonly spawn: ClaudeSpawn
  private readonly queue = new EventQueue<SessionEvent>()
  private readonly sessions = new Map<string, SessionRec>()
  private readonly running = new Map<string, ClaudeProc>()
  /** Per run: tool callId → tool name, so tool_result can name its tool. */
  private readonly toolNames = new Map<string, string>()
  /** Sessions that saw a terminal `result` line, so exit doesn't double-emit. */
  private readonly finished = new Set<string>()
  private stopped = false

  constructor(opts: ClaudeCodeAdapterOptions = {}) {
    this.cwd = opts.cwd ?? process.cwd()
    this.spawn = opts.spawn ?? bunClaudeSpawn
  }

  /**
   * Installed AND usable: `claude --version` runs and `claude auth status`
   * reports a logged-in account. Mirrors OpenCodeAdapter treating "reachable and
   * working" as installed — an unauthed CLI would only produce failures, so it
   * stays out of the New Session picker (Beta §8.2).
   */
  async isInstalled(): Promise<boolean> {
    try {
      const version = this.spawn(["--version"], { cwd: this.cwd })
      if ((await version.exited) !== 0) return false

      const auth = this.spawn(["auth", "status"], { cwd: this.cwd })
      const [code, out] = await Promise.all([auth.exited, collect(auth.stdoutLines)])
      if (code !== 0) return false
      return /"loggedIn"\s*:\s*true/.test(out)
    } catch {
      return false
    }
  }

  async start(): Promise<void> {
    // Nothing to connect to — subprocesses are spawned per prompt.
  }

  async listSessions(): Promise<AgentSession[]> {
    // Only sessions this adapter instance created. Claude Code print mode has no
    // machine-wide "list sessions" surface; a host restart forgets them (v1).
    return [...this.sessions.values()].map((s) => this.toAgentSession(s))
  }

  async createSession(projectPath: string): Promise<AgentSession> {
    const cwd = !projectPath || projectPath === "." ? this.cwd : projectPath
    const rec: SessionRec = { id: crypto.randomUUID(), cwd, turns: 0 }
    this.sessions.set(rec.id, rec)
    this.emit(rec.id, { type: "session.started", sessionId: rec.id })
    return this.toAgentSession(rec)
  }

  async sendPrompt(sessionId: string, text: string): Promise<void> {
    let rec = this.sessions.get(sessionId)
    if (!rec) {
      // Autovivify so a session created out-of-band can still be prompted.
      rec = { id: sessionId, cwd: this.cwd, turns: 0 }
      this.sessions.set(sessionId, rec)
    }

    const idFlag = rec.turns === 0 ? ["--session-id", rec.id] : ["--resume", rec.id]
    const proc = this.spawn(["-p", text, ...idFlag, ...STREAM_FLAGS], { cwd: rec.cwd })
    rec.turns += 1
    this.running.set(sessionId, proc)
    this.finished.delete(sessionId)
    void this.readLoop(sessionId, proc)
  }

  async abortSession(sessionId: string): Promise<void> {
    this.running.get(sessionId)?.kill("SIGTERM")
  }

  async requestDiff(_sessionId: string): Promise<DiffSnapshot> {
    // Claude Code edits files on disk directly, so the git working tree of the
    // session's cwd is the source of truth for what changed.
    return { files: readGitWorkingTree(this.cwd) }
  }

  async respondToPermission(): Promise<void> {
    // Claude Code print mode has no interactive permission bridge — it applies
    // `--permission-mode` and reports denials in the result. Wiring an approval
    // round-trip needs stream-json *input* + control messages; tracked for a
    // follow-up. No-op keeps the interface satisfied.
  }

  events(): AsyncIterable<SessionEvent> {
    return this.queue
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const proc of this.running.values()) proc.kill("SIGTERM")
    this.running.clear()
    this.queue.close()
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private emit(sessionId: string, event: SessionEvent["event"]): void {
    if (!this.stopped) this.queue.push({ sessionId, event })
  }

  private toAgentSession(rec: SessionRec): AgentSession {
    return {
      id: rec.id,
      title: rec.cwd.split("/").filter(Boolean).pop() ?? "session",
      projectPath: rec.cwd,
      model: "Claude Code",
      status: "idle",
    }
  }

  /** Drain one run's NDJSON, then settle the session on process exit. */
  private async readLoop(sessionId: string, proc: ClaudeProc): Promise<void> {
    try {
      for await (const line of proc.stdoutLines) {
        if (this.stopped) break
        if (line.trim()) this.normalize(sessionId, line)
      }
    } catch {
      // stream errors fall through to the exit handling below
    }

    const code = await proc.exited.catch(() => 1)
    this.running.delete(sessionId)
    if (this.stopped) return

    if (this.finished.delete(sessionId)) return // a `result` line already settled it
    if (code === 0) {
      this.emit(sessionId, { type: "agent.completed" })
    } else {
      const err = (await proc.stderr.catch(() => "")).trim().slice(0, 500)
      this.emit(sessionId, {
        type: "agent.failed",
        error: err || `claude exited with code ${code}`,
      })
    }
  }

  /** Map one stream-json line onto zero or more normalized SessionEvents. */
  private normalize(sessionId: string, raw: string): void {
    let line: CcLine
    try {
      line = JSON.parse(raw) as CcLine
    } catch {
      return // not JSON (banner text, etc.) — ignore, like OpenCode's default
    }

    switch (line.type) {
      case "stream_event": {
        const ev = line.event
        if (
          ev?.type === "content_block_delta" &&
          ev.delta?.type === "text_delta" &&
          ev.delta.text
        ) {
          this.emit(sessionId, { type: "assistant.delta", text: ev.delta.text })
        }
        return
      }

      case "assistant": {
        for (const block of line.message?.content ?? []) {
          // text blocks already arrived as deltas; only tools are new here.
          if (block.type === "tool_use" && block.id) {
            this.toolNames.set(block.id, block.name ?? "tool")
            this.emit(sessionId, {
              type: "tool.started",
              tool: block.name ?? "tool",
              callId: block.id,
              input: block.input,
            })
          }
        }
        return
      }

      case "user": {
        for (const block of line.message?.content ?? []) {
          if (block.type === "tool_result" && block.tool_use_id) {
            this.emit(sessionId, {
              type: "tool.completed",
              tool: this.toolNames.get(block.tool_use_id) ?? "tool",
              callId: block.tool_use_id,
              output: block.content,
            })
          }
        }
        return
      }

      case "result": {
        this.finished.add(sessionId)
        this.toolNames.clear()
        const failed = line.is_error === true || (line.subtype ?? "").startsWith("error")
        if (failed) {
          this.emit(sessionId, { type: "agent.failed", error: extractResultError(line) })
        } else {
          this.emit(sessionId, { type: "agent.completed" })
        }
        return
      }

      default:
        // system/init, rate_limit_event, anything unmapped — ignored in v1.
        return
    }
  }
}

/** Default spawner: a real `claude` subprocess with piped streams. */
const bunClaudeSpawn: ClaudeSpawn = (args, opts) => {
  const proc = Bun.spawn(["claude", ...args], {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  })
  return {
    stdoutLines: toLines(proc.stdout as ReadableStream<Uint8Array>),
    stderr: new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    exited: proc.exited,
    kill: (signal) => {
      try {
        proc.kill(signal)
      } catch {
        // already gone
      }
    },
  }
}

/** Byte stream → newline-delimited strings. */
async function* toLines(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl = buf.indexOf("\n")
      while (nl !== -1) {
        yield buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        nl = buf.indexOf("\n")
      }
    }
  } finally {
    reader.releaseLock()
  }
  if (buf) yield buf
}

async function collect(lines: AsyncIterable<string>): Promise<string> {
  let out = ""
  for await (const line of lines) out += `${line}\n`
  return out
}

function extractResultError(line: CcLine): string {
  if (typeof line.result === "string" && line.result) return line.result
  if (line.error) return line.error
  return line.subtype || "claude run failed"
}

// ── Minimal structural mirrors of the stream-json lines we touch ─────────────
// Kept local (not the full Agent SDK types) so the normalization surface is
// small and explicit, same discipline as the OpenCode adapter.

type CcContentBlock = {
  type: string
  // text block
  text?: string
  // tool_use block
  id?: string
  name?: string
  input?: unknown
  // tool_result block
  tool_use_id?: string
  content?: unknown
}

type CcMessage = { content?: CcContentBlock[] }

type CcStreamEvent = {
  type?: string
  delta?: { type?: string; text?: string }
}

type CcLine = {
  type: string
  subtype?: string
  is_error?: boolean
  result?: unknown
  error?: string
  message?: CcMessage
  event?: CcStreamEvent
}
