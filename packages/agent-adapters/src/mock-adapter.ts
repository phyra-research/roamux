import type { AgentSession, ChangedFile, DiffSnapshot } from "@openremote/protocol"
import { newId } from "@openremote/protocol"
import { EventQueue } from "./event-queue.js"
import type { HarnessAdapter, SessionEvent } from "./types.js"

/** A believable 2-file change set returned by `requestDiff` unless reseeded. */
const DEFAULT_MOCK_DIFF: ChangedFile[] = [
  {
    path: "src/auth.ts",
    status: "modified",
    patch: [
      "--- a/src/auth.ts",
      "+++ b/src/auth.ts",
      "@@ -1,3 +1,4 @@",
      " export function auth() {",
      "-  return false",
      "+  // TODO: real check",
      "+  return true",
      " }",
      "",
    ].join("\n"),
    additions: 2,
    deletions: 1,
  },
  {
    path: "NOTES.md",
    status: "added",
    patch: ["--- /dev/null", "+++ b/NOTES.md", "@@ -0,0 +1,1 @@", "+scratch notes", ""].join("\n"),
    additions: 1,
    deletions: 0,
  },
]

/**
 * A deterministic, model-free HarnessAdapter used to build and test the whole
 * vertical slice without OpenCode. It scripts a believable agent run:
 *   prompt → deltas → tool.start/complete → (optional permission) → message → done
 *
 * Behavior is controlled by keywords in the prompt so tests can drive specific
 * paths:
 *   - contains "permission" → emits a permission.requested and waits for a reply
 *   - contains "fail"       → emits agent.failed
 * Everything is timed with small delays so the UI shows a live stream.
 */
export class MockAgentAdapter implements HarnessAdapter {
  readonly id = "mock"
  readonly displayName = "Mock"
  /** @deprecated use `id` */
  readonly name = "mock"

  /** The mock harness is always "installed". */
  isInstalled(): Promise<boolean> {
    return Promise.resolve(true)
  }

  private readonly queue = new EventQueue<SessionEvent>()
  private readonly sessions = new Map<string, AgentSession>()
  private readonly aborters = new Map<string, AbortController>()
  private readonly pendingPermissions = new Map<string, (r: "allow" | "deny") => void>()
  private readonly stepMs: number

  /** Diff returned by requestDiff(); overridable via seedDiff/seedDiffError. */
  private diffFiles: ChangedFile[] = DEFAULT_MOCK_DIFF
  private diffError: string | null = null

  constructor(opts: { stepMs?: number; seedSession?: boolean } = {}) {
    this.stepMs = opts.stepMs ?? 350
    if (opts.seedSession ?? true) {
      const seed: AgentSession = {
        id: "mock-session-1",
        title: "my-project",
        projectPath: "/Users/you/code/my-project",
        model: "Mock / OpenRemote",
        status: "idle",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      this.sessions.set(seed.id, seed)
    }
  }

  async start(): Promise<void> {
    // Nothing to connect to.
  }

  async listSessions(): Promise<AgentSession[]> {
    return [...this.sessions.values()]
  }

  async createSession(projectPath: string): Promise<AgentSession> {
    const session: AgentSession = {
      id: `mock-${newId().slice(0, 8)}`,
      title: projectPath.split("/").filter(Boolean).pop() ?? "new-session",
      projectPath,
      model: "Mock / OpenRemote",
      status: "idle",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.sessions.set(session.id, session)
    this.emit(session.id, { type: "session.started", sessionId: session.id })
    return session
  }

  async sendPrompt(sessionId: string, text: string): Promise<void> {
    if (!this.sessions.has(sessionId)) {
      // Autovivify so the UI can prompt sessions created out-of-band in tests.
      this.sessions.set(sessionId, {
        id: sessionId,
        title: "session",
        model: "Mock / OpenRemote",
        status: "idle",
      })
    }
    // Run the scripted response without blocking the command handler.
    void this.runScript(sessionId, text)
  }

  async abortSession(sessionId: string): Promise<void> {
    this.aborters.get(sessionId)?.abort()
  }

  /** Seed the fixed diff `requestDiff` returns (used by tests + smoke). */
  seedDiff(files: ChangedFile[]): void {
    this.diffFiles = files
    this.diffError = null
  }

  /** Make the next requestDiff() reject, to exercise the host's error path. */
  seedDiffError(message: string): void {
    this.diffError = message
  }

  async requestDiff(_sessionId: string): Promise<DiffSnapshot> {
    if (this.diffError) throw new Error(this.diffError)
    return { files: this.diffFiles }
  }

  async respondToPermission(
    sessionId: string,
    permissionId: string,
    response: "allow" | "deny",
  ): Promise<void> {
    const resolver = this.pendingPermissions.get(permissionId)
    if (resolver) {
      this.pendingPermissions.delete(permissionId)
      this.emit(sessionId, { type: "permission.resolved", permissionId, response })
      resolver(response)
    }
  }

  events(): AsyncIterable<SessionEvent> {
    return this.queue
  }

  async stop(): Promise<void> {
    for (const ac of this.aborters.values()) ac.abort()
    this.queue.close()
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private emit(sessionId: string, event: SessionEvent["event"]): void {
    this.queue.push({ sessionId, event })
  }

  private setStatus(sessionId: string, status: AgentSession["status"]): void {
    const s = this.sessions.get(sessionId)
    if (s) s.status = status
  }

  private async runScript(sessionId: string, prompt: string): Promise<void> {
    const ac = new AbortController()
    this.aborters.set(sessionId, ac)
    this.setStatus(sessionId, "running")

    try {
      await this.delay(ac.signal)
      const readCallId = `call-${newId().slice(0, 8)}`
      this.emit(sessionId, {
        type: "tool.started",
        tool: "read",
        callId: readCallId,
        input: { path: "README.md" },
      })
      await this.delay(ac.signal)
      this.emit(sessionId, {
        type: "tool.completed",
        tool: "read",
        callId: readCallId,
        output: "# my-project\nA sample repository.",
      })
      this.emit(sessionId, { type: "file.changed", path: "README.md" })

      await this.delay(ac.signal)
      const grepCallId = `call-${newId().slice(0, 8)}`
      this.emit(sessionId, {
        type: "tool.started",
        tool: "grep",
        callId: grepCallId,
        input: { pattern: "auth" },
      })
      await this.delay(ac.signal)
      this.emit(sessionId, {
        type: "tool.completed",
        tool: "grep",
        callId: grepCallId,
        output: "src/auth.ts:12",
      })

      for (const chunk of ["I inspected ", "the repository ", "and here is ", "what it does…"]) {
        await this.delay(ac.signal)
        this.emit(sessionId, { type: "assistant.delta", text: chunk })
      }

      if (/permission/i.test(prompt)) {
        const permissionId = `perm-${newId().slice(0, 8)}`
        this.setStatus(sessionId, "waiting")
        this.emit(sessionId, { type: "agent.waiting" })
        this.emit(sessionId, {
          type: "permission.requested",
          permissionId,
          description: "Run: bun test",
          tool: "bash",
          input: { command: "bun test" },
        })
        const decision = await this.waitForPermission(permissionId, ac.signal)
        this.setStatus(sessionId, "running")
        if (decision === "deny") {
          await this.delay(ac.signal)
          this.emit(sessionId, {
            type: "assistant.message",
            text: "Understood — I won't run the tests.",
          })
          this.finish(sessionId)
          return
        }
        await this.delay(ac.signal)
        this.emit(sessionId, { type: "terminal.output", text: "✓ 10 pass, 0 fail" })
      }

      if (/fail/i.test(prompt)) {
        this.emit(sessionId, {
          type: "agent.failed",
          error: "Simulated failure (prompt contained 'fail').",
        })
        this.setStatus(sessionId, "error")
        return
      }

      await this.delay(ac.signal)
      this.emit(sessionId, {
        type: "assistant.message",
        text: `This project is a sample repository. You asked: "${prompt}".`,
      })
      this.finish(sessionId)
    } catch (err) {
      if (ac.signal.aborted) {
        this.emit(sessionId, { type: "assistant.message", text: "⏹ Run stopped." })
        this.emit(sessionId, { type: "agent.completed" })
        this.setStatus(sessionId, "idle")
      } else {
        this.emit(sessionId, { type: "agent.failed", error: (err as Error).message })
        this.setStatus(sessionId, "error")
      }
    } finally {
      this.aborters.delete(sessionId)
    }
  }

  private finish(sessionId: string): void {
    this.emit(sessionId, { type: "agent.completed" })
    this.setStatus(sessionId, "idle")
  }

  private delay(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error("aborted"))
      const t = setTimeout(resolve, this.stepMs)
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t)
          reject(new Error("aborted"))
        },
        { once: true },
      )
    })
  }

  private waitForPermission(permissionId: string, signal: AbortSignal): Promise<"allow" | "deny"> {
    return new Promise((resolve, reject) => {
      this.pendingPermissions.set(permissionId, resolve)
      signal.addEventListener(
        "abort",
        () => {
          this.pendingPermissions.delete(permissionId)
          reject(new Error("aborted"))
        },
        { once: true },
      )
    })
  }
}
