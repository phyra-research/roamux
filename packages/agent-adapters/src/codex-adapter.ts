import type { AgentSession, ChangedFile, DiffSnapshot } from "@openremote/protocol"
import { EventQueue } from "./event-queue.js"
import { readGitWorkingTree } from "./git-diff.js"
import type { HarnessAdapter, SessionEvent } from "./types.js"

/**
 * CodexAdapter — the ONLY place Codex CLI (`codex`) specifics may live
 * (CLAUDE.md §2). It maps `codex exec --json` NDJSON to the OpenRemote
 * vocabulary.
 *
 * Same shape as ClaudeCodeAdapter (subprocess-per-prompt), not OpenCode's
 * long-lived server: `codex app-server` is `[experimental]` JSON-RPC with no
 * stable documented wire contract, while `codex exec --json` is a stable,
 * scriptable, one-subprocess-per-prompt surface — `claude -p`'s analog.
 *
 * One mechanical difference from Claude Code: Codex assigns the thread id
 * itself (there's no `--session-id`-equivalent flag on `codex exec`), so this
 * adapter mints its OWN id at createSession() — same contract every other
 * adapter gives the rest of the system — and separately tracks the real Codex
 * thread id once `thread.started` reports it, for `exec resume` on turn 2+.
 *
 * SECURITY (CLAUDE.md §3): no shell (argv array), the prompt is one argv
 * element, nothing raw off stdout/stderr reaches the wire — every line is
 * normalized to an AgentEvent here, same as the other adapters. Credentials
 * are never read; `codex` owns its own auth.
 */

/** How we spawn `codex`. Injected so tests never touch a real process. */
export type CodexSpawn = (args: string[], opts: { cwd?: string }) => CodexProc

export type CodexProc = {
  /** stdout, already split into lines (newline stripped). */
  stdoutLines: AsyncIterable<string>
  /** Full stderr text, resolved when the process exits. */
  stderr: Promise<string>
  /** Exit code. */
  exited: Promise<number>
  /** Signal the process. */
  kill: (signal?: NodeJS.Signals) => void
}

export type CodexAdapterOptions = {
  /** Working directory for `codex` runs. Defaults to `process.cwd()`. */
  cwd?: string
  /** Test seam — defaults to a real `Bun.spawn(["codex", …])`. */
  spawn?: CodexSpawn
  /** Test seam: override the git-backed working-tree read (defaults to real git). */
  gitDiff?: (cwd: string) => ChangedFile[]
}

/**
 * Sandbox latitude for a first `codex exec` turn — the same "can edit within
 * the project" latitude OpenCode and Claude Code get by default. `codex exec
 * resume` doesn't accept `-s`; a resumed thread keeps whatever sandbox its
 * first turn set (verified via `codex exec resume --help` — no -s/-C there).
 */
const SANDBOX_MODE = "workspace-write"

type SessionRec = { id: string; cwd: string; turns: number; codexThreadId?: string }

export class CodexAdapter implements HarnessAdapter {
  readonly id = "codex"
  readonly displayName = "Codex"
  /** @deprecated use `id` */
  readonly name = "codex"

  private readonly cwd: string
  private readonly spawn: CodexSpawn
  private readonly gitDiff: (cwd: string) => ChangedFile[]
  private readonly queue = new EventQueue<SessionEvent>()
  private readonly sessions = new Map<string, SessionRec>()
  private readonly running = new Map<string, CodexProc>()
  /** Sessions that saw a terminal `turn.completed`, so exit doesn't double-emit. */
  private readonly finished = new Set<string>()
  private stopped = false

  constructor(opts: CodexAdapterOptions = {}) {
    this.cwd = opts.cwd ?? process.cwd()
    this.spawn = opts.spawn ?? bunCodexSpawn
    this.gitDiff = opts.gitDiff ?? readGitWorkingTree
  }

  /**
   * Installed AND usable: `codex --version` runs and `codex login status`
   * reports a logged-in account. Mirrors the other adapters treating
   * "reachable and working" as installed — an unauthed CLI would only produce
   * failures, so it stays out of the New Session picker (Beta §8.2).
   */
  async isInstalled(): Promise<boolean> {
    try {
      const version = this.spawn(["--version"], { cwd: this.cwd })
      if ((await version.exited) !== 0) return false

      const status = this.spawn(["login", "status"], { cwd: this.cwd })
      // `codex login status` prints its human-readable status to STDERR, not
      // stdout (verified) — check both so a future version swapping streams
      // doesn't silently break this.
      const [code, out, err] = await Promise.all([
        status.exited,
        collect(status.stdoutLines),
        status.stderr,
      ])
      if (code !== 0) return false
      // "Logged in using …" vs "Not logged in" — anchor so the latter doesn't
      // false-match on the "logged in" substring it also contains.
      return /^logged in/i.test(out.trim()) || /^logged in/i.test(err.trim())
    } catch {
      return false
    }
  }

  async start(): Promise<void> {
    // Nothing to connect to — subprocesses are spawned per prompt.
  }

  async listSessions(): Promise<AgentSession[]> {
    // Only sessions this adapter instance created. `codex exec resume --last`
    // is machine-wide (not scoped to us), and there's no clean "list mine"
    // surface, so a host restart forgets these — same v1 limitation as
    // Claude Code.
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

    // codex exec resume takes neither -s nor -C — a resumed thread keeps the
    // sandbox and directory its first turn set (verified via --help).
    const args = rec.codexThreadId
      ? ["exec", "resume", rec.codexThreadId, "--json", "--skip-git-repo-check", text]
      : ["exec", "--json", "--skip-git-repo-check", "-s", SANDBOX_MODE, text]
    const proc = this.spawn(args, { cwd: rec.cwd })
    rec.turns += 1
    this.running.set(sessionId, proc)
    this.finished.delete(sessionId)
    void this.readLoop(rec, proc)
  }

  async abortSession(sessionId: string): Promise<void> {
    this.running.get(sessionId)?.kill("SIGTERM")
  }

  /**
   * The project's uncommitted changes (working tree vs. git HEAD) — same
   * git-backed source OpenCodeAdapter uses (see git-diff.ts). Codex has no
   * native diff/VCS endpoint of its own to merge in, so this is a direct
   * pass-through; `sessionId` is unused (git doesn't scope by session) but
   * kept to satisfy the shared HarnessAdapter contract.
   */
  async requestDiff(_sessionId: string): Promise<DiffSnapshot> {
    return { files: this.gitDiff(this.cwd) }
  }

  async respondToPermission(): Promise<void> {
    // `codex exec` has no interactive approval bridge — it applies the -s
    // sandbox policy and the model self-reports a blocked action as a normal
    // agent_message (verified: a blocked write surfaced as an agent_message,
    // no distinct permission-request event). No-op keeps the interface
    // satisfied; wiring a real approval round-trip needs app-server's JSON-RPC
    // surface instead, tracked as a follow-up.
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
      model: "Codex",
      status: "idle",
    }
  }

  /** Drain one run's NDJSON, then settle the session on process exit. */
  private async readLoop(rec: SessionRec, proc: CodexProc): Promise<void> {
    try {
      for await (const line of proc.stdoutLines) {
        if (this.stopped) break
        if (line.trim()) this.normalize(rec, line)
      }
    } catch {
      // stream errors fall through to the exit handling below
    }

    const code = await proc.exited.catch(() => 1)
    this.running.delete(rec.id)
    if (this.stopped) return

    if (this.finished.delete(rec.id)) return // a turn.completed line already settled it
    if (code === 0) {
      this.emit(rec.id, { type: "agent.completed" })
    } else {
      // Hard failures (bad resume id, auth lapse, …) print plain text to
      // stderr and exit non-zero — nothing JSON ever lands on stdout for
      // them (verified). That's the truth serum for failures here, same
      // fallback shape as Claude Code.
      const err = (await proc.stderr.catch(() => "")).trim().slice(0, 500)
      this.emit(rec.id, {
        type: "agent.failed",
        error: err || `codex exited with code ${code}`,
      })
    }
  }

  /** Map one stream-json line onto zero or more normalized SessionEvents. */
  private normalize(rec: SessionRec, raw: string): void {
    let line: CxLine
    try {
      line = JSON.parse(raw) as CxLine
    } catch {
      return // not JSON (banner text, etc.) — ignore, like the other adapters
    }

    switch (line.type) {
      case "thread.started": {
        if (line.thread_id) rec.codexThreadId = line.thread_id
        return
      }

      case "item.started": {
        const item = line.item
        // agent_message never appears as item.started (only item.completed,
        // with the full text — codex exec has no delta/partial streaming).
        if (item?.id && item.type !== "agent_message") {
          this.emit(rec.id, {
            type: "tool.started",
            tool: item.type,
            callId: item.id,
            input: item.command ? { command: item.command } : undefined,
          })
        }
        return
      }

      case "item.completed": {
        const item = line.item
        if (!item) return
        if (item.type === "agent_message") {
          if (item.text) this.emit(rec.id, { type: "assistant.message", text: item.text })
          return
        }
        this.emit(rec.id, {
          type: "tool.completed",
          tool: item.type,
          callId: item.id,
          output: item.aggregated_output ?? item.exit_code,
        })
        // Surface file edits as file.changed so the UI renders a file-edit block
        // (#94). Codex reports edits via file_change / patch_apply items carrying
        // the affected path(s).
        for (const path of filePathsFromCodexItem(item)) {
          this.emit(rec.id, { type: "file.changed", path })
        }
        return
      }

      case "turn.completed": {
        this.finished.add(rec.id)
        this.emit(rec.id, { type: "agent.completed" })
        return
      }

      default:
        // turn.started (no payload we use) and anything unmapped — ignored in v1.
        return
    }
  }
}

/** Default spawner: a real `codex` subprocess with piped streams. */
const bunCodexSpawn: CodexSpawn = (args, opts) => {
  const proc = Bun.spawn(["codex", ...args], {
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

// ── Minimal structural mirrors of the codex exec --json lines we touch ───────
// Kept local (not any Codex SDK type) so the normalization surface is small
// and explicit, same discipline as the other adapters.

type CxItem = {
  id?: string
  type: string
  /** agent_message */
  text?: string
  /** command_execution */
  command?: string
  aggregated_output?: string
  exit_code?: number
  status?: string
  /** file_change / patch_apply: a single path, or a list of changed files. */
  path?: string
  changes?: { path?: string }[]
}

/**
 * File path(s) a completed Codex item edits, or [] if it changed no files.
 * Codex reports edits as a `file_change` / `patch_apply` item carrying either a
 * single `path` or a `changes[]` list. Defensive about the exact shape so a
 * schema tweak degrades to "no file.changed" rather than throwing.
 */
function filePathsFromCodexItem(item: CxItem): string[] {
  const fileItem = item.type === "file_change" || item.type === "patch_apply"
  if (!fileItem) return []
  const paths: string[] = []
  if (typeof item.path === "string" && item.path) paths.push(item.path)
  for (const c of item.changes ?? []) {
    if (typeof c?.path === "string" && c.path) paths.push(c.path)
  }
  return paths
}

type CxLine = {
  type: string
  /** thread.started */
  thread_id?: string
  /** item.started / item.completed */
  item?: CxItem
}
