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

/**
 * V0/Phase-1 rendezvous channel derived from the pairing token. Before accounts
 * exist (Phase 2), the host and a paired client share this one channel as the
 * meeting point — both sides know the token, so neither needs a hostId up front.
 * Superseded by the user/host-scoped channels above once auth lands.
 */
export function pairingChannel(token: string): string {
  return `${NS}:pair:${token}`
}
