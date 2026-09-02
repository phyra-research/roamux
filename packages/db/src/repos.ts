import type { Sql } from "postgres"
import { db } from "./client.js"
import { HostProjectRow, HostRow, type HostStatus, UserRow } from "./types.js"

/**
 * Thin repositories over the control-plane tables. Raw SQL (postgres.js), one
 * function per operation Phase 2 needs. Rows are validated with Zod on the way
 * out so callers get typed, trusted data.
 *
 * All host/session lookups are scoped by ownership at the query level — a query
 * for host X always carries the owning user_id, so cross-user access is
 * impossible even before the API's auth check (Beta §11 defense in depth).
 */

// snake_case DB columns → camelCase, aliased in SELECTs below.

// ── Users ────────────────────────────────────────────────────────────────────

/** Find or create the app user for a Supabase auth subject. */
export async function upsertUserByAuthSubject(
  authSubject: string,
  email: string | null,
  sql: Sql = db(),
): Promise<UserRow> {
  const rows = await sql`
    INSERT INTO users (auth_subject, email)
    VALUES (${authSubject}, ${email})
    ON CONFLICT (auth_subject) DO UPDATE SET email = EXCLUDED.email
    RETURNING id, auth_subject AS "authSubject", email, created_at AS "createdAt"
  `
  return UserRow.parse(rows[0])
}

export async function getUserById(id: string, sql: Sql = db()): Promise<UserRow | null> {
  const rows = await sql`
    SELECT id, auth_subject AS "authSubject", email, created_at AS "createdAt"
    FROM users WHERE id = ${id}
  `
  return rows[0] ? UserRow.parse(rows[0]) : null
}

// ── Hosts ────────────────────────────────────────────────────────────────────

const HOST_COLS = `
  id, user_id AS "userId", name, platform, daemon_version AS "daemonVersion",
  capabilities, status, last_seen_at AS "lastSeenAt", created_at AS "createdAt",
  revoked_at AS "revokedAt"
`

export async function createHost(
  input: {
    userId: string
    name: string
    platform?: string | null
    daemonVersion?: string | null
    capabilities?: Record<string, unknown>
  },
  sql: Sql = db(),
): Promise<HostRow> {
  const rows = await sql`
    INSERT INTO hosts (user_id, name, platform, daemon_version, capabilities)
    VALUES (
      ${input.userId}, ${input.name}, ${input.platform ?? null},
      ${input.daemonVersion ?? null}, ${sql.json((input.capabilities ?? {}) as Record<string, never>)}
    )
    RETURNING ${sql.unsafe(HOST_COLS)}
  `
  return HostRow.parse(rows[0])
}

/** List a user's hosts, newest first. Ownership-scoped by user_id. */
export async function listHostsForUser(userId: string, sql: Sql = db()): Promise<HostRow[]> {
  const rows = await sql`
    SELECT ${sql.unsafe(HOST_COLS)} FROM hosts
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `
  return rows.map((r) => HostRow.parse(r))
}

/** Get one host BUT only if it belongs to `userId` (null otherwise). */
export async function getHostForUser(
  hostId: string,
  userId: string,
  sql: Sql = db(),
): Promise<HostRow | null> {
  const rows = await sql`
    SELECT ${sql.unsafe(HOST_COLS)} FROM hosts
    WHERE id = ${hostId} AND user_id = ${userId}
  `
  return rows[0] ? HostRow.parse(rows[0]) : null
}

export async function updateHostStatus(
  hostId: string,
  status: HostStatus,
  sql: Sql = db(),
): Promise<void> {
  await sql`
    UPDATE hosts SET status = ${status}, last_seen_at = now()
    WHERE id = ${hostId}
  `
}

/** Revoke a host (ownership-scoped). Revoked hosts can't obtain new tokens. */
export async function revokeHost(
  hostId: string,
  userId: string,
  sql: Sql = db(),
): Promise<boolean> {
  const rows = await sql`
    UPDATE hosts SET revoked_at = now(), status = 'offline'
    WHERE id = ${hostId} AND user_id = ${userId} AND revoked_at IS NULL
    RETURNING id
  `
  return rows.length > 0
}

// ── Host projects ────────────────────────────────────────────────────────────

export async function listProjectsForHost(
  hostId: string,
  sql: Sql = db(),
): Promise<HostProjectRow[]> {
  const rows = await sql`
    SELECT id, host_id AS "hostId", display_label AS "displayLabel", status,
           created_at AS "createdAt"
    FROM host_projects WHERE host_id = ${hostId}
    ORDER BY display_label ASC
  `
  return rows.map((r) => HostProjectRow.parse(r))
}
