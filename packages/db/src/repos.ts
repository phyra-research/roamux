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

/** Rename a host (ownership-scoped). Returns the updated row, or null if not owned. */
export async function renameHost(
  hostId: string,
  userId: string,
  name: string,
  sql: Sql = db(),
): Promise<HostRow | null> {
  const rows = await sql`
    UPDATE hosts SET name = ${name}
    WHERE id = ${hostId} AND user_id = ${userId}
    RETURNING ${sql.unsafe(HOST_COLS)}
  `
  return rows[0] ? HostRow.parse(rows[0]) : null
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

// ── Device authorization (openremote login) ──────────────────────────────────

export type DeviceAuthRow = {
  id: string
  deviceCode: string
  userCode: string
  hostName: string
  platform: string | null
  status: string
  userId: string | null
  hostId: string | null
  hostSecret: string | null
  expiresAt: Date
}

const DA_COLS = `
  id, device_code AS "deviceCode", user_code AS "userCode", host_name AS "hostName",
  platform, status, user_id AS "userId", host_id AS "hostId",
  host_secret AS "hostSecret", expires_at AS "expiresAt"
`

/** Start a device-auth request; the daemon polls with deviceCode. */
export async function createDeviceAuth(
  input: { deviceCode: string; userCode: string; hostName: string; platform?: string | null },
  sql: Sql = db(),
): Promise<DeviceAuthRow> {
  const rows = await sql`
    INSERT INTO device_auth (device_code, user_code, host_name, platform)
    VALUES (${input.deviceCode}, ${input.userCode}, ${input.hostName}, ${input.platform ?? null})
    RETURNING ${sql.unsafe(DA_COLS)}
  `
  return rows[0] as DeviceAuthRow
}

/** Look up a pending request by the user-typed code (browser approval screen). */
export async function getDeviceAuthByUserCode(
  userCode: string,
  sql: Sql = db(),
): Promise<DeviceAuthRow | null> {
  const rows = await sql`
    SELECT ${sql.unsafe(DA_COLS)} FROM device_auth
    WHERE user_code = ${userCode} AND status = 'pending' AND expires_at > now()
  `
  return (rows[0] as DeviceAuthRow | undefined) ?? null
}

/** Look up by device code (daemon poll). */
export async function getDeviceAuthByDeviceCode(
  deviceCode: string,
  sql: Sql = db(),
): Promise<DeviceAuthRow | null> {
  const rows = await sql`
    SELECT ${sql.unsafe(DA_COLS)} FROM device_auth WHERE device_code = ${deviceCode}
  `
  return (rows[0] as DeviceAuthRow | undefined) ?? null
}

/** Approve a device request: bind it to the user + host, store the host secret. */
export async function approveDeviceAuth(
  userCode: string,
  userId: string,
  hostId: string,
  hostSecret: string,
  sql: Sql = db(),
): Promise<boolean> {
  const rows = await sql`
    UPDATE device_auth
    SET status = 'approved', user_id = ${userId}, host_id = ${hostId},
        host_secret = ${hostSecret}
    WHERE user_code = ${userCode} AND status = 'pending' AND expires_at > now()
    RETURNING id
  `
  return rows.length > 0
}

/** Mark an approved request consumed once the daemon has fetched the secret. */
export async function consumeDeviceAuth(deviceCode: string, sql: Sql = db()): Promise<void> {
  await sql`UPDATE device_auth SET status = 'consumed', host_secret = NULL WHERE device_code = ${deviceCode}`
}

// ── Host credentials ─────────────────────────────────────────────────────────

/** Store a host credential HASH (never the raw secret). */
export async function createHostCredential(
  hostId: string,
  credentialHash: string,
  sql: Sql = db(),
): Promise<void> {
  await sql`INSERT INTO host_credentials (host_id, credential_hash) VALUES (${hostId}, ${credentialHash})`
}

/** Verify a host credential hash is active (not revoked) for a host. */
export async function hostCredentialIsValid(
  hostId: string,
  credentialHash: string,
  sql: Sql = db(),
): Promise<boolean> {
  const rows = await sql`
    SELECT hc.id FROM host_credentials hc
    JOIN hosts h ON h.id = hc.host_id
    WHERE hc.host_id = ${hostId} AND hc.credential_hash = ${credentialHash}
      AND hc.revoked_at IS NULL AND h.revoked_at IS NULL
  `
  return rows.length > 0
}

// ── MCP OAuth (remote-auth state) ─────────────────────────────────────────────
// roamux as a thin OAuth authorization server for the MCP endpoint. Login is
// delegated to Supabase; these tables hold only OAuth plumbing (registered
// clients + one-time PKCE codes) — never Ably keys or file content.

export type OAuthClientRow = {
  id: string
  clientId: string
  clientName: string | null
  redirectUris: string[]
  createdAt: Date
}

const OAUTH_CLIENT_COLS = `
  id, client_id AS "clientId", client_name AS "clientName",
  redirect_uris AS "redirectUris", created_at AS "createdAt"
`

/** Register a dynamic OAuth client (RFC 7591). Public client — PKCE, no secret. */
export async function createOAuthClient(
  input: { clientId: string; clientName?: string | null; redirectUris: string[] },
  sql: Sql = db(),
): Promise<OAuthClientRow> {
  const rows = await sql`
    INSERT INTO oauth_clients (client_id, client_name, redirect_uris)
    VALUES (${input.clientId}, ${input.clientName ?? null}, ${sql.json(input.redirectUris)})
    RETURNING ${sql.unsafe(OAUTH_CLIENT_COLS)}
  `
  return rows[0] as OAuthClientRow
}

/** Look up a registered client by its client_id. */
export async function getOAuthClient(
  clientId: string,
  sql: Sql = db(),
): Promise<OAuthClientRow | null> {
  const rows = await sql`
    SELECT ${sql.unsafe(OAUTH_CLIENT_COLS)} FROM oauth_clients WHERE client_id = ${clientId}
  `
  return (rows[0] as OAuthClientRow | undefined) ?? null
}

export type OAuthCodeRow = {
  id: string
  code: string
  clientId: string
  userId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string
  state: string | null
  consumed: boolean
  expiresAt: Date
}

const OAUTH_CODE_COLS = `
  id, code, client_id AS "clientId", user_id AS "userId",
  redirect_uri AS "redirectUri", code_challenge AS "codeChallenge",
  code_challenge_method AS "codeChallengeMethod", state, consumed,
  expires_at AS "expiresAt"
`

/** Issue a one-time authorization code, bound to the user + PKCE challenge. */
export async function createOAuthCode(
  input: {
    code: string
    clientId: string
    userId: string
    redirectUri: string
    codeChallenge: string
    codeChallengeMethod?: string
    state?: string | null
  },
  sql: Sql = db(),
): Promise<void> {
  await sql`
    INSERT INTO oauth_codes
      (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, state)
    VALUES (
      ${input.code}, ${input.clientId}, ${input.userId}, ${input.redirectUri},
      ${input.codeChallenge}, ${input.codeChallengeMethod ?? "S256"}, ${input.state ?? null}
    )
  `
}

/**
 * Atomically consume a valid, unconsumed, unexpired code and return it. Uses a
 * conditional UPDATE so a code can never be exchanged twice (OAuth 2.1).
 */
export async function consumeOAuthCode(
  code: string,
  sql: Sql = db(),
): Promise<OAuthCodeRow | null> {
  const rows = await sql`
    UPDATE oauth_codes SET consumed = true
    WHERE code = ${code} AND consumed = false AND expires_at > now()
    RETURNING ${sql.unsafe(OAUTH_CODE_COLS)}
  `
  return (rows[0] as OAuthCodeRow | undefined) ?? null
}
