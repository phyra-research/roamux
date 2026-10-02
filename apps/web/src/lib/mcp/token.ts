/**
 * Minimal HS256 JWT for the roamux MCP access token — no external dependency,
 * runs on Node and the Vercel runtime (Web Crypto `crypto.subtle`).
 *
 * The access token is what an MCP client (Claude, ChatGPT, …) presents on every
 * `/api/mcp` call. It is roamux-signed and carries ONLY the roamux userId (plus
 * standard claims). It is NOT an Ably key and NOT a Supabase token — it is an
 * opaque bearer that the MCP route verifies to resolve the user, then mints a
 * short-lived scoped Ably token per request (see the route).
 *
 * Signing secret: `MCP_TOKEN_SECRET` (server env, never shipped to a client).
 */

const AUD = "roamux-mcp"
const DEFAULT_TTL_SECONDS = 60 * 60 // 1 hour

type Claims = {
  sub: string // roamux userId
  aud: string
  iat: number
  exp: number
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function b64urlEncodeString(s: string): string {
  return b64urlEncode(new TextEncoder().encode(s))
}

function b64urlDecodeToString(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  )
}

/** Constant-time string compare (avoid signature-timing leaks). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Mint a roamux MCP access token for a user. */
export async function signAccessToken(
  userId: string,
  secret: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const claims: Claims = { sub: userId, aud: AUD, iat: now, exp: now + ttlSeconds }
  const header = b64urlEncodeString(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = b64urlEncodeString(JSON.stringify(claims))
  const data = `${header}.${payload}`
  const key = await hmacKey(secret)
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)))
  return `${data}.${b64urlEncode(sig)}`
}

/** Verify a token and return its userId (`sub`), or null if invalid/expired. */
export async function verifyAccessToken(token: string, secret: string): Promise<string | null> {
  const parts = token.split(".")
  if (parts.length !== 3) return null
  const [header, payload, sig] = parts as [string, string, string]
  const data = `${header}.${payload}`
  const key = await hmacKey(secret)
  const expected = b64urlEncode(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))),
  )
  if (!timingSafeEqual(sig, expected)) return null

  let claims: Claims
  try {
    claims = JSON.parse(b64urlDecodeToString(payload)) as Claims
  } catch {
    return null
  }
  if (claims.aud !== AUD) return null
  if (typeof claims.exp !== "number" || claims.exp < Math.floor(Date.now() / 1000)) return null
  if (typeof claims.sub !== "string" || claims.sub.length === 0) return null
  return claims.sub
}

/** The configured signing secret, or null if MCP auth isn't configured. */
export function mcpTokenSecret(): string | null {
  const s = process.env.MCP_TOKEN_SECRET
  return s && s.length > 0 ? s : null
}
