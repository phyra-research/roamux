import { type UserRow, upsertUserByAuthSubject } from "@openremote/db"
import { getSupabaseServerClient } from "../supabase/server.js"

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
 * caller is not authenticated.
 *
 * Order: (1) a real Supabase session (verified server-side from the auth
 * cookie), then (2) a dev-only escape hatch gated behind OPENREMOTE_DEV_AUTH_
 * SUBJECT — never set in production, so it can't weaken it.
 */
async function resolveAuthSubject(
  _req: Request,
): Promise<{ subject: string; email: string | null } | null> {
  const supabase = await getSupabaseServerClient()
  if (supabase) {
    // getUser() re-validates the JWT with the auth server — trustworthy, unlike
    // reading the session cookie directly.
    const { data, error } = await supabase.auth.getUser()
    if (!error && data.user) {
      return { subject: data.user.id, email: data.user.email ?? null }
    }
  }

  // why: dev-only escape hatch for local API work without a login flow. Gated
  // behind an explicit env var so production (where it is unset) never uses it.
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
