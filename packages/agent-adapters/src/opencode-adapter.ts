import { type OpencodeClient, createOpencodeClient } from "@opencode-ai/sdk"
import type { AgentSession, ChangedFile, DiffSnapshot } from "@openremote/protocol"
import { EventQueue } from "./event-queue.js"
import { mergeChangedFiles, readGitWorkingTree } from "./git-diff.js"
import type { HarnessAdapter, SessionEvent } from "./types.js"
import { makeUnifiedDiff } from "./unified-diff.js"

/**
 * OpenCodeAdapter — the ONLY place `@opencode-ai/sdk` may be imported
 * (CLAUDE.md §2). It maps OpenCode's HTTP/SSE API to the OpenRemote vocabulary.
 *
 * Connects to an OpenCode server that MUST be bound to localhost. This adapter
 * does not spawn OpenCode itself — see apps/host for lifecycle management — it
 * only talks to a URL it's given.
 */
export type OpenCodeAdapterOptions = {
  /** Base URL of a running `opencode serve`, e.g. http://127.0.0.1:4096 */
  baseUrl: string
  /** Default working directory for new sessions / prompts. */
  directory?: string
  /** Test seam: override the git-backed working-tree read (defaults to real git). */
  gitDiff?: (cwd: string) => ChangedFile[]
}

export class OpenCodeAdapter implements HarnessAdapter {
  readonly id = "opencode"
  readonly displayName = "OpenCode"
  /** @deprecated use `id` */
  readonly name = "opencode"

  private readonly client: OpencodeClient
  private readonly queue = new EventQueue<SessionEvent>()
  private readonly directory: string
  private readonly gitDiff: (cwd: string) => ChangedFile[]
  private eventLoop: Promise<void> | null = null
  private stopped = false

  /** Cache of the last known model label per session, for nicer UI. */
  private readonly modelLabels = new Map<string, string>()

  /**
   * Sessions that just emitted a `session.error`. OpenCode fires `session.idle`
   * immediately AFTER an error, which would otherwise emit a masking
   * `agent.completed` ("Done") on top of the failure. We consume the flag on the
   * next idle so the UI shows the error, not a false success.
   */
  private readonly erroredSessions = new Set<string>()

  /**
   * messageID → role. We learn roles from `message.updated` and only stream text
   * from ASSISTANT messages — otherwise OpenCode's echo of the user's prompt
   * (its own text part) would render as if the agent said it.
   */
  private readonly messageRoles = new Map<string, string>()

  /**
   * text part id → last text we've already emitted. This OpenCode build sends
   * the FULL running text on each `message.part.updated` (no `delta` field), so
   * we compute the newly-appended suffix ourselves and emit that as a delta.
   * Works for both incremental streaming and single-shot (batched) updates.
   */
  private readonly emittedText = new Map<string, string>()

  constructor(opts: OpenCodeAdapterOptions) {
    this.directory = opts.directory ?? process.cwd()
    this.client = createOpencodeClient({ baseUrl: opts.baseUrl })
    this.gitDiff = opts.gitDiff ?? readGitWorkingTree
  }

  /**
   * OpenCode is "installed" for this adapter's purposes if its server responds.
   * The daemon points us at a URL it controls (a spawned `opencode serve`), so a
   * successful session.list is a good liveness/availability probe.
   */
  async isInstalled(): Promise<boolean> {
    try {
      await this.client.session.list({ query: { directory: this.directory } })
      return true
    } catch {
      return false
    }
  }

  async start(): Promise<void> {
    // Kick off the SSE consumer. It self-heals inside subscribeLoop().
    this.eventLoop = this.subscribeLoop()
  }

  async listSessions(): Promise<AgentSession[]> {
    // List ALL sessions on this OpenCode server, not just those under one
    // directory — OpenRemote is a remote-control surface for the whole machine,
    // and sessions may span multiple projects. We pass the adapter's directory
    // only as OpenCode's routing hint, then surface everything it returns.
    const res = await this.client.session.list({ query: { directory: this.directory } })
    const list = (res.data ?? []) as OcSession[]
    // Sort newest-first so the freshest work is at the top of the UI.
    return list
      .map((s) => this.toAgentSession(s))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }

  async createSession(projectPath: string): Promise<AgentSession> {
    // Normalize "." / "" to the adapter's configured directory so a created
    // session lands in the same directory listSessions() reads from — otherwise
    // OpenCode's directory-scoped listing would hide it.
    const directory = !projectPath || projectPath === "." ? this.directory : projectPath
    const res = await this.client.session.create({
      query: { directory },
      body: {},
    })
    const info = res.data as OcSession | undefined
    if (!info) throw new Error("opencode: session.create returned no data")
    return this.toAgentSession(info, directory)
  }

  async sendPrompt(sessionId: string, text: string): Promise<void> {
    await this.client.session.promptAsync({
      path: { id: sessionId },
      query: { directory: this.directory },
      body: { parts: [{ type: "text", text }] },
    })
  }

  async abortSession(sessionId: string): Promise<void> {
    await this.client.session.abort({
      path: { id: sessionId },
      query: { directory: this.directory },
    })
  }

  /**
   * The project's uncommitted changes (working tree vs. git HEAD) — the same set
   * `git status` shows, which is what a user checks against.
   *
   * `git` is authoritative: OpenCode 1.18.x's `session.diff` / `file.status` /
   * `Session.summary` return zero even for sessions that clearly edited files
   * (verified via curl on 1.18.27). We still fold in OpenCode's view when it has
   * one, but git wins on every path it reports.
   */
  async requestDiff(sessionId: string): Promise<DiffSnapshot> {
    const fromGit = this.gitDiff(this.directory)
    const fromOpenCode = await this.openCodeDiff(sessionId).catch(() => [] as ChangedFile[])
    return { files: mergeChangedFiles(fromGit, fromOpenCode) }
  }

  /** OpenCode's own idea of the diff — best-effort, usually empty on 1.18.x. */
  private async openCodeDiff(sessionId: string): Promise<ChangedFile[]> {
    const statusRes = await this.client.file.status({ query: { directory: this.directory } })
    const changed = (statusRes.data ?? []) as OcFile[]
    if (changed.length === 0) return []

    const sessionDiffs = new Map<string, OcFileDiff>()
    try {
      const dRes = await this.client.session.diff({
        path: { id: sessionId },
        query: { directory: this.directory },
      })
      for (const fd of (dRes.data ?? []) as OcFileDiff[]) sessionDiffs.set(fd.file, fd)
    } catch {
      // Session diff is best-effort; the file list already stands on its own.
    }

    const files: ChangedFile[] = []
    for (const f of changed.slice(0, MAX_DIFF_FILES)) {
      files.push({
        path: f.path,
        status: f.status,
        additions: f.added ?? 0,
        deletions: f.removed ?? 0,
        patch: await this.patchFor(f, sessionDiffs.get(f.path)),
      })
    }
    return files
  }

  /** Best available unified-diff text for one changed file. */
  private async patchFor(f: OcFile, sd: OcFileDiff | undefined): Promise<string> {
    if (sd) return makeUnifiedDiff(f.path, sd.before ?? "", sd.after ?? "")
    if (f.status === "deleted") return "" // nothing to read; the badge says enough
    try {
      const res = await this.client.file.read({
        query: { directory: this.directory, path: f.path },
      })
      const fc = res.data as OcFileContent | undefined
      if (fc?.diff) return fc.diff
      if (f.status === "added" && fc?.type === "text") {
        return makeUnifiedDiff(f.path, "", fc.content ?? "")
      }
    } catch {
      // fall through to an empty patch
    }
    return ""
  }

  async respondToPermission(
    sessionId: string,
    permissionId: string,
    response: "allow" | "deny",
  ): Promise<void> {
    await this.client.postSessionIdPermissionsPermissionId({
      path: { id: sessionId, permissionID: permissionId },
      query: { directory: this.directory },
      body: { response: response === "allow" ? "once" : "reject" },
    })
  }

  events(): AsyncIterable<SessionEvent> {
    return this.queue
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.queue.close()
    await this.eventLoop?.catch(() => {})
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private toAgentSession(s: OcSession, projectPath?: string): AgentSession {
    return {
      id: s.id,
      title: s.title || "session",
      projectPath: projectPath ?? s.directory,
      model: this.modelLabels.get(s.id) ?? "OpenCode",
      status: "idle",
      createdAt: s.time?.created,
      updatedAt: s.time?.updated,
    }
  }

  /**
   * Consume OpenCode's SSE stream and normalize each event. Reconnects with a
   * short backoff if the stream drops, until stop() is called (M3 will add
   * proper resume; today a reconnect just resubscribes to the live stream).
   */
  private async subscribeLoop(): Promise<void> {
    let backoffMs = 500
    while (!this.stopped) {
      try {
        const subscription = await this.client.event.subscribe()
        const stream = subscription.stream as AsyncIterable<OcEvent> | undefined
        if (!stream) throw new Error("opencode: event.subscribe returned no stream")
        backoffMs = 500
        for await (const event of stream) {
          if (this.stopped) break
          this.normalize(event)
        }
      } catch (err) {
        if (this.stopped) break
        // Surface, then back off and retry.
        console.error("[opencode] event stream error:", (err as Error).message)
      }
      if (this.stopped) break
      await new Promise((r) => setTimeout(r, backoffMs))
      backoffMs = Math.min(backoffMs * 2, 5000)
    }
  }

  /** Map a single OpenCode event onto zero or more normalized SessionEvents. */
  private normalize(event: OcEvent): void {
    const emit = (sessionId: string, e: SessionEvent["event"]) =>
      this.queue.push({ sessionId, event: e })
    const props = (event.properties ?? {}) as Record<string, unknown>

    switch (event.type) {
      case "session.created": {
        const info = props.info as OcSession | undefined
        if (info?.id) emit(info.id, { type: "session.started", sessionId: info.id })
        return
      }

      case "message.part.updated": {
        const part = props.part as OcPart | undefined
        if (!part) return
        const sessionId = part.sessionID
        if (!sessionId) return

        if (part.type === "text") {
          // Only stream text from ASSISTANT messages — never echo the user's
          // own prompt back as agent output. If we haven't seen the role yet,
          // default to allowing (roles usually arrive first, but be lenient).
          const role = part.messageID ? this.messageRoles.get(part.messageID) : undefined
          if (role === "user") return

          const full = part.text ?? ""
          // Prefer an explicit delta if the server sends one; otherwise compute
          // the appended suffix ourselves (this build sends full running text).
          const explicitDelta = props.delta as string | undefined
          const partKey = part.id ?? `${part.messageID}:text`
          if (explicitDelta) {
            this.emittedText.set(partKey, full)
            emit(sessionId, { type: "assistant.delta", text: explicitDelta })
            return
          }
          const prev = this.emittedText.get(partKey) ?? ""
          if (full.length > prev.length && full.startsWith(prev)) {
            const suffix = full.slice(prev.length)
            this.emittedText.set(partKey, full)
            if (suffix) emit(sessionId, { type: "assistant.delta", text: suffix })
          } else if (full !== prev) {
            // Text changed non-monotonically (edit/rewrite) — replace wholesale.
            this.emittedText.set(partKey, full)
            emit(sessionId, { type: "assistant.message", text: full })
          }
          return
        }
        if (part.type === "tool") {
          const status = part.state?.status
          if (status === "running" || status === "pending") {
            emit(sessionId, {
              type: "tool.started",
              tool: part.tool ?? "tool",
              callId: part.callID,
              input: part.state?.input,
            })
          } else if (status === "completed") {
            emit(sessionId, {
              type: "tool.completed",
              tool: part.tool ?? "tool",
              callId: part.callID,
              output: part.state?.output,
            })
          } else if (status === "error") {
            emit(sessionId, {
              type: "tool.completed",
              tool: part.tool ?? "tool",
              callId: part.callID,
              output: part.state?.error,
            })
          }
        }
        return
      }

      case "message.updated": {
        // Learn the role of each message so text-part streaming can tell the
        // user's echoed prompt apart from the assistant's reply. We rely on
        // per-part deltas for the actual text, so we don't re-emit here.
        const info = props.info as { id?: string; role?: string } | undefined
        if (info?.id && info.role) this.messageRoles.set(info.id, info.role)
        return
      }

      case "permission.updated": {
        const p = event.properties as OcPermission | undefined
        if (!p?.id || !p.sessionID) return
        emit(p.sessionID, {
          type: "permission.requested",
          permissionId: p.id,
          description: p.title || describePermission(p),
          tool: p.type,
          input: p.metadata,
        })
        return
      }

      case "permission.replied": {
        const sessionID = props.sessionID as string | undefined
        const permissionID = props.permissionID as string | undefined
        const response = props.response as string | undefined
        if (sessionID && permissionID) {
          emit(sessionID, {
            type: "permission.resolved",
            permissionId: permissionID,
            response: response === "reject" ? "deny" : "allow",
          })
        }
        return
      }

      case "file.edited": {
        const file = props.file as string | undefined
        const sessionID = props.sessionID as string | undefined
        // No session scoping on some builds; skip if we can't attribute it.
        if (file && sessionID) emit(sessionID, { type: "file.changed", path: file })
        return
      }

      case "session.idle": {
        const sessionID = props.sessionID as string | undefined
        if (!sessionID) return
        // If this idle immediately follows an error, don't mask it with "Done".
        if (this.erroredSessions.delete(sessionID)) return
        emit(sessionID, { type: "agent.completed" })
        return
      }

      case "session.error": {
        const sessionID = props.sessionID as string | undefined
        const message = extractErrorMessage(props.error)
        if (sessionID) {
          this.erroredSessions.add(sessionID)
          emit(sessionID, { type: "agent.failed", error: message })
        }
        return
      }

      default:
        // Unmapped events are intentionally ignored in V0.
        return
    }
  }
}

function describePermission(p: OcPermission): string {
  const cmd =
    (p.metadata && (p.metadata.command as string | undefined)) ||
    (Array.isArray(p.pattern) ? p.pattern.join(" ") : p.pattern)
  return cmd ? `Run: ${cmd}` : `Permission requested: ${p.type}`
}

function extractErrorMessage(error: unknown): string {
  if (!error) return "unknown error"
  if (typeof error === "string") return error
  const e = error as { name?: string; data?: { message?: string }; message?: string }
  return e.data?.message ?? e.message ?? e.name ?? "unknown error"
}

// ── Minimal structural mirrors of the OpenCode SDK types we touch ────────────
// We keep these local (rather than importing every generated type) so the
// normalization surface is explicit and small.

type OcSession = {
  id: string
  title: string
  directory?: string
  time?: { created?: number; updated?: number }
}

type OcPermission = {
  id: string
  type: string
  sessionID: string
  title?: string
  pattern?: string | string[]
  metadata?: Record<string, unknown>
}

/** Cap the per-request fan-out of file.read() calls on a large uncommitted tree. */
const MAX_DIFF_FILES = 100

/** OpenCode's `GET /file/status` item: one working-tree change vs git HEAD. */
type OcFile = {
  path: string
  added?: number
  removed?: number
  status: ChangedFile["status"]
}

/** OpenCode's `GET /file/content` result — `diff` is a unified diff vs HEAD. */
type OcFileContent = {
  type: "text" | "binary"
  content?: string
  diff?: string
}

/** OpenCode's `GET /session/{id}/diff` item: before/after file contents. */
type OcFileDiff = {
  file: string
  before?: string
  after?: string
  additions?: number
  deletions?: number
}

type OcToolState = {
  status?: "pending" | "running" | "completed" | "error"
  input?: unknown
  output?: unknown
  error?: unknown
}

type OcPart = {
  type: string
  id?: string
  sessionID?: string
  messageID?: string
  text?: string
  tool?: string
  callID?: string
  state?: OcToolState
}

/**
 * A single loose shape for every SSE event. We validate/cast `properties`
 * per-case in normalize() rather than relying on a discriminated union, because
 * OpenCode's event surface is large and versions faster than we want to track.
 */
type OcEvent = { type: string; properties?: unknown }
