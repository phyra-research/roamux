import { describe, expect, test } from "bun:test"
import { HostRow, HostStatus, UserRow } from "./types.js"

/**
 * Validate the DB-boundary Zod parsers. We don't hit a live Postgres here (tests
 * must not depend on a machine/network — CLAUDE.md); the repos run raw SQL and
 * are exercised against a real DB in the Phase 2 exit test. These lock the row
 * shapes the repos rely on.
 */
describe("db row parsers", () => {
  test("UserRow accepts a valid row and rejects a bad uuid", () => {
    const now = new Date()
    const ok = UserRow.parse({
      id: "11111111-1111-1111-1111-111111111111",
      authSubject: "22222222-2222-2222-2222-222222222222",
      email: "a@b.com",
      createdAt: now,
    })
    expect(ok.email).toBe("a@b.com")
    expect(() =>
      UserRow.parse({ id: "not-a-uuid", authSubject: null, email: null, createdAt: now }),
    ).toThrow()
  })

  test("UserRow allows null authSubject + email", () => {
    const row = UserRow.parse({
      id: "11111111-1111-1111-1111-111111111111",
      authSubject: null,
      email: null,
      createdAt: new Date(),
    })
    expect(row.authSubject).toBeNull()
  })

  test("HostStatus is a closed enum", () => {
    expect(HostStatus.parse("online")).toBe("online")
    expect(() => HostStatus.parse("bogus")).toThrow()
  })

  test("HostRow parses capabilities as an object and status as enum", () => {
    const row = HostRow.parse({
      id: "33333333-3333-3333-3333-333333333333",
      userId: "11111111-1111-1111-1111-111111111111",
      name: "MacBook",
      platform: "darwin-arm64",
      daemonVersion: "0.0.0",
      capabilities: { harnesses: ["opencode"] },
      status: "online",
      lastSeenAt: new Date(),
      createdAt: new Date(),
      revokedAt: null,
    })
    expect(row.capabilities.harnesses).toEqual(["opencode"])
    expect(row.status).toBe("online")
  })
})
