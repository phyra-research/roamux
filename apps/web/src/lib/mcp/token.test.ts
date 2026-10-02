import { describe, expect, test } from "bun:test"
import { s256Challenge, verifyPkce } from "./pkce.js"
import { signAccessToken, verifyAccessToken } from "./token.js"

const SECRET = "test-secret-do-not-use-in-prod"

describe("MCP access token", () => {
  test("round-trips: a signed token verifies back to its userId", async () => {
    const token = await signAccessToken("user-123", SECRET)
    expect(await verifyAccessToken(token, SECRET)).toBe("user-123")
  })

  test("rejects a token signed with a different secret", async () => {
    const token = await signAccessToken("user-123", SECRET)
    expect(await verifyAccessToken(token, "other-secret")).toBeNull()
  })

  test("rejects a tampered payload", async () => {
    const token = await signAccessToken("user-123", SECRET)
    const [h, _p, s] = token.split(".")
    // swap in a forged payload (different sub) while keeping the old signature
    const forged = `${h}.${btoa(
      JSON.stringify({ sub: "attacker", aud: "roamux-mcp", iat: 0, exp: 9999999999 }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")}.${s}`
    expect(await verifyAccessToken(forged, SECRET)).toBeNull()
  })

  test("rejects an expired token", async () => {
    const token = await signAccessToken("user-123", SECRET, -1) // already expired
    expect(await verifyAccessToken(token, SECRET)).toBeNull()
  })

  test("rejects a malformed token", async () => {
    expect(await verifyAccessToken("not.a.jwt", SECRET)).toBeNull()
    expect(await verifyAccessToken("garbage", SECRET)).toBeNull()
  })
})

describe("PKCE", () => {
  test("S256: a verifier matches the challenge computed from it", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    const challenge = await s256Challenge(verifier)
    expect(await verifyPkce(verifier, challenge, "S256")).toBe(true)
  })

  test("S256: a wrong verifier fails", async () => {
    const challenge = await s256Challenge("the-real-verifier")
    expect(await verifyPkce("a-different-verifier", challenge, "S256")).toBe(false)
  })

  test("rejects an unsupported method", async () => {
    expect(await verifyPkce("x", "x", "nope")).toBe(false)
  })
})
