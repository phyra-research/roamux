import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import postgres from "postgres"
import { setDb } from "./client.js"
import { migrate } from "./migrate.js"
import {
  createHost,
  getHostForUser,
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
})
