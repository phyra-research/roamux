import { type UserRow, upsertUserByAuthSubject } from "@openremote/db"

/**
 * Resolve the authenticated app user for a request.
 *
 * Phase 2 scaffold: real Supabase-Auth JWT verification lands in #18. For now,
 * auth is resolved from a Supabase auth-subject (uuid) that #18 will extract
 * from a verified JWT. To keep local development unblocked before auth is wired,
 * a DEV fallback (`OPENREMOTE_DEV_AUTH_SUBJECT`) injects a fixed subject — but
 * ONLY when explicitly set, so it can never accidentally weaken production.
 *
 * The contract is stable: `requireUser(req)` returns a `UserRow` or throws an
 * `AuthError`; #18 swaps the subject source without touching any handler.
 */

export class AuthError extends Error {
  constructor(message = "unauthorized") {
    super(message)
    this.name = "AuthError"
  }
}

/**
 * Extract the Supabase auth subject (uuid) for the request. Returns null if the
 * caller is not authenticated. Replaced in #18 with real JWT verification.
 */
async function resolveAuthSubject(
  _req: Request,
): Promise<{ subject: string; email: string | null } | null> {
  // why: dev-only escape hatch, gated behind an explicit env var so production
  // (where it is unset) always falls through to "no auth" until #18 lands.
  const devSubject = process.env.OPENREMOTE_DEV_AUTH_SUBJECT
  if (devSubject) {
    return { subject: devSubject, email: process.env.OPENREMOTE_DEV_AUTH_EMAIL ?? null }
  }
  return null
}

/** Resolve (and upsert) the app user for a request, or throw AuthError. */
export async function requireUser(req: Request): Promise<UserRow> {
  const auth = await resolveAuthSubject(req)
  if (!auth) throw new AuthError()
  return upsertUserByAuthSubject(auth.subject, auth.email)
}
