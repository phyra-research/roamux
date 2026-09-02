/**
 * Ably channel naming (Beta §5.4). Two concepts, kept separate so authorization
 * can be scoped per-user and per-host, and host-control traffic never mixes with
 * session activity:
 *
 *   control  → presence, capabilities, session list, session.create
 *   session  → prompts, runs, tool events, permissions, diffs (one per session)
 *
 * V0 has no userId yet, so a "local" placeholder is used until accounts land in
 * Phase 2. The shape is stable; only the userId value changes.
 */
const NS = "openremote"

export const LOCAL_USER = "local"

/** Host-control channel for a given user + host. */
export function controlChannel(hostId: string, userId: string = LOCAL_USER): string {
  return `${NS}:user:${userId}:host:${hostId}:control`
}

/** Per-session activity channel for a given user + host + session. */
export function sessionChannel(
  hostId: string,
  sessionId: string,
  userId: string = LOCAL_USER,
): string {
  return `${NS}:user:${userId}:host:${hostId}:session:${sessionId}`
}
