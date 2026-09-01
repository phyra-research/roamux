import type { AgentEvent, AgentSession } from "@openremote/protocol"

/** An AgentEvent tagged with the session it belongs to. */
export type SessionEvent = {
  sessionId: string
  event: AgentEvent
}

/**
 * The single boundary between OpenRemote and any concrete agent runtime.
 *
 * Implementations translate OpenRemote's small command/event vocabulary to and
 * from a runtime's native API. The host depends ONLY on this interface — swap
 * the implementation and everything above it (host, relay, web) is unchanged.
 */
export interface AgentAdapter {
  /** Stable identifier for this runtime, e.g. "mock", "opencode". */
  readonly name: string

  /** Connect to / start the runtime. Safe to call once at host startup. */
  start(): Promise<void>

  /** List sessions currently known to the runtime. */
  listSessions(): Promise<AgentSession[]>

  /** Create a new session rooted at a project directory. */
  createSession(projectPath: string): Promise<AgentSession>

  /** Send a user instruction to a session (fire-and-forget; results arrive as events). */
  sendPrompt(sessionId: string, text: string): Promise<void>

  /** Ask the runtime to stop the current run for a session. */
  abortSession(sessionId: string): Promise<void>

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
