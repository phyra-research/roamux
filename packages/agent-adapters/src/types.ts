import type { AgentEvent, AgentSession, DiffSnapshot } from "@openremote/protocol"

/** An AgentEvent tagged with the session it belongs to. */
export type SessionEvent = {
  sessionId: string
  event: AgentEvent
}

/**
 * The single boundary between OpenRemote and any concrete agent runtime
 * ("harness" internally; "Agent" in the UI).
 *
 * Implementations translate OpenRemote's small command/event vocabulary to and
 * from a runtime's native API. The host depends ONLY on this interface — swap
 * the implementation and everything above it (host, relay, web) is unchanged.
 *
 * Beta note: `events()` currently returns ONE merged, session-tagged stream that
 * the host pump drains. Per-session `events(sessionId)` streams arrive with the
 * HostSessionManager (issue #25), when the daemon owns each session's lifecycle.
 */
export interface HarnessAdapter {
  /** Stable identifier for this runtime, e.g. "mock", "opencode", "claude-code". */
  readonly id: string

  /** Human-readable name for the UI, e.g. "OpenCode", "Claude Code". */
  readonly displayName: string

  /**
   * Back-compat alias for `id`. V0 code referred to `adapter.name`; kept so the
   * rename is non-breaking. Prefer `id`.
   * @deprecated use `id`
   */
  readonly name: string

  /**
   * Whether this harness is actually installed/available on the host. Lets the
   * daemon advertise only usable harnesses in its capability list (Beta §8.2).
   */
  isInstalled(): Promise<boolean>

  /** Connect to / start the runtime. Safe to call once at host startup. */
  start(): Promise<void>

  /** List sessions currently known to the runtime. */
  listSessions(): Promise<AgentSession[]>

  /** Create a new session rooted at a project directory. */
  createSession(projectPath: string): Promise<AgentSession>

  /**
   * Reattach to an existing runtime-owned session by its external id, where the
   * harness supports it. Optional: harnesses that cannot resume simply omit it,
   * and the daemon marks such sessions INTERRUPTED instead (Beta §9, R2).
   */
  resume?(externalSessionId: string): Promise<AgentSession>

  /** Send a user instruction to a session (fire-and-forget; results arrive as events). */
  sendPrompt(sessionId: string, text: string): Promise<void>

  /** Ask the runtime to stop the current run for a session. */
  abortSession(sessionId: string): Promise<void>

  /**
   * The set of files the agent has changed in this session, normalized to a
   * runtime-agnostic shape. Implementations translate their native diff/VCS
   * output; callers never see a runtime-specific type.
   */
  requestDiff(sessionId: string): Promise<DiffSnapshot>

  /** Answer a pending permission request. */
  respondToPermission(
    sessionId: string,
    permissionId: string,
    response: "allow" | "deny",
  ): Promise<void>

  /**
   * A never-ending stream of normalized, session-tagged events. The host
   * consumes this, attaches sequence numbers, and forwards to the relay.
   */
  events(): AsyncIterable<SessionEvent>

  /** Release resources. */
  stop(): Promise<void>
}

/**
 * Back-compat alias. V0 named this `AgentAdapter`; Beta renames it
 * `HarnessAdapter`. Kept so the rename lands without breaking imports.
 * @deprecated use `HarnessAdapter`
 */
export type AgentAdapter = HarnessAdapter
