import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import postgres from "postgres"
import { setDb } from "./client.js"
import { migrate } from "./migrate.js"
import {
  approveDeviceAuth,
  consumeDeviceAuth,
  createDeviceAuth,
  createHost,
  createHostCredential,
  getDeviceAuthByDeviceCode,
  getHostForUser,
  hostCredentialIsValid,
  listHostsForUser,
  revokeHost,
  updateHostStatus,
  upsertUserByAuthSubject,
} from "./repos.js"

/**
 * Integration tests against a REAL Postgres, proving the raw SQL in the repos.
 * OPT-IN: they run only when RUN_DB_TESTS=1 (and DATABASE_URL is set), so the
 * default `bun run check` stays green on any machine without a DB (CLAUDE.md:
 * tests must not depend on a machine/network). Locally we point them at a
 * Postgres container; they rely on the type-parser unit tests otherwise.
 *
 * Run: `RUN_DB_TESTS=1 DATABASE_URL=postgres://... bun test packages/db`.
 */
const DB_URL = process.env.DATABASE_URL
const ENABLED = process.env.RUN_DB_TESTS === "1" && !!DB_URL
const maybe = ENABLED ? describe : describe.skip

maybe("repos against real Postgres", () => {
  // onnotice: silence Postgres NOTICE chatter (truncate cascades, etc.).
  const sql = DB_URL ? postgres(DB_URL, { prepare: false, max: 3, onnotice: () => {} }) : null

  beforeAll(async () => {
    if (!sql) return
    setDb(sql)
    await migrate()
    // Clean slate for these tests.
    await sql`TRUNCATE users RESTART IDENTITY CASCADE`
  })

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 })
  })

  test("upsert user is idempotent on auth_subject", async () => {
    const sub = crypto.randomUUID()
    const a = await upsertUserByAuthSubject(sub, "x@y.com", sql!)
    const b = await upsertUserByAuthSubject(sub, "x2@y.com", sql!)
    expect(b.id).toBe(a.id) // same user
    expect(b.email).toBe("x2@y.com") // email updated
  })

  test("hosts are ownership-scoped: user B cannot see user A's host", async () => {
    const userA = await upsertUserByAuthSubject(crypto.randomUUID(), null, sql!)
    const userB = await upsertUserByAuthSubject(crypto.randomUUID(), null, sql!)
    const host = await createHost(
      { userId: userA.id, name: "A-MacBook", capabilities: { harnesses: ["opencode"] } },
      sql!,
    )

    expect(await getHostForUser(host.id, userA.id, sql!)).not.toBeNull()
    // The cross-user lookup must return null even with a valid host id.
    expect(await getHostForUser(host.id, userB.id, sql!)).toBeNull()

    const listA = await listHostsForUser(userA.id, sql!)
    const listB = await listHostsForUser(userB.id, sql!)
    expect(listA.map((h) => h.id)).toContain(host.id)
    expect(listB.map((h) => h.id)).not.toContain(host.id)
  })

  test("status update and revoke", async () => {
    const user = await upsertUserByAuthSubject(crypto.randomUUID(), null, sql!)
    const host = await createHost({ userId: user.id, name: "H" }, sql!)

    await updateHostStatus(host.id, "online", sql!)
    const online = await getHostForUser(host.id, user.id, sql!)
    expect(online?.status).toBe("online")

    // Revoke succeeds once, then is a no-op (already revoked).
    expect(await revokeHost(host.id, user.id, sql!)).toBe(true)
    expect(await revokeHost(host.id, user.id, sql!)).toBe(false)
    const revoked = await getHostForUser(host.id, user.id, sql!)
    expect(revoked?.revokedAt).not.toBeNull()

    // Another user cannot revoke it.
    const other = await upsertUserByAuthSubject(crypto.randomUUID(), null, sql!)
    expect(await revokeHost(host.id, other.id, sql!)).toBe(false)
  })

  // ── #24 exit test: strict two-host routing + revoke at the data layer ──────
  test("two-host isolation: credentials + revoke are strictly scoped", async () => {
    const userA = await upsertUserByAuthSubject(crypto.randomUUID(), null, sql!)
    const userB = await upsertUserByAuthSubject(crypto.randomUUID(), null, sql!)
    const hostA = await createHost({ userId: userA.id, name: "A-host" }, sql!)
    const hostB = await createHost({ userId: userB.id, name: "B-host" }, sql!)

    // Each host has its own credential.
    await createHostCredential(hostA.id, hashHex("secretA"), sql!)
    await createHostCredential(hostB.id, hashHex("secretB"), sql!)

    // A credential is valid ONLY for its own host — B's secret can't auth as A.
    expect(await hostCredentialIsValid(hostA.id, hashHex("secretA"), sql!)).toBe(true)
    expect(await hostCredentialIsValid(hostA.id, hashHex("secretB"), sql!)).toBe(false)
    expect(await hostCredentialIsValid(hostB.id, hashHex("secretA"), sql!)).toBe(false)

    // User B's host list never contains user A's host, and vice versa.
    const listA = await listHostsForUser(userA.id, sql!)
    const listB = await listHostsForUser(userB.id, sql!)
    expect(listA.map((h) => h.id)).toContain(hostA.id)
    expect(listA.map((h) => h.id)).not.toContain(hostB.id)
    expect(listB.map((h) => h.id)).toContain(hostB.id)
    expect(listB.map((h) => h.id)).not.toContain(hostA.id)

    // Revoking host A invalidates ITS credential but not host B's.
    await revokeHost(hostA.id, userA.id, sql!)
    expect(await hostCredentialIsValid(hostA.id, hashHex("secretA"), sql!)).toBe(false)
    expect(await hostCredentialIsValid(hostB.id, hashHex("secretB"), sql!)).toBe(true)
  })

  test("device-auth: approve binds to the approving user, secret is one-time", async () => {
    const user = await upsertUserByAuthSubject(crypto.randomUUID(), null, sql!)
    const da = await createDeviceAuth(
      { deviceCode: `dc-${crypto.randomUUID()}`, userCode: `UC-${Date.now()}`, hostName: "H" },
      sql!,
    )
    // Before approval, poll-by-device is pending.
    const pending = await getDeviceAuthByDeviceCode(da.deviceCode, sql!)
    expect(pending?.status).toBe("pending")

    const host = await createHost({ userId: user.id, name: "H" }, sql!)
    expect(await approveDeviceAuth(da.userCode, user.id, host.id, "raw-secret", sql!)).toBe(true)

    const approved = await getDeviceAuthByDeviceCode(da.deviceCode, sql!)
    expect(approved?.status).toBe("approved")
    expect(approved?.userId).toBe(user.id)
    expect(approved?.hostSecret).toBe("raw-secret")

    // Consuming clears the secret (one-time delivery).
    await consumeDeviceAuth(da.deviceCode, sql!)
    const consumed = await getDeviceAuthByDeviceCode(da.deviceCode, sql!)
    expect(consumed?.status).toBe("consumed")
    expect(consumed?.hostSecret).toBeNull()
  })
})

/** Local sha256 hex — mirrors the API's hashSecret so credential rows match. */
function hashHex(s: string): string {
  const h = new Bun.CryptoHasher("sha256")
  h.update(s)
  return h.digest("hex")
}
