/**
 * PKCE (RFC 7636) verification for the MCP OAuth flow. The client sends a
 * `code_challenge` at /authorize and the matching `code_verifier` at /token; we
 * recompute the challenge from the verifier and compare. Defends public clients
 * against authorization-code interception.
 */

function b64url(bytes: Uint8Array): string {
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Compute the S256 challenge for a verifier: BASE64URL(SHA256(verifier)). */
export async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return b64url(new Uint8Array(digest))
}

/**
 * Verify a PKCE `code_verifier` against the stored `code_challenge`.
 * Supports S256 (required) and plain (allowed by spec; we accept it only if the
 * client registered it — callers pass the stored method).
 */
export async function verifyPkce(
  verifier: string,
  challenge: string,
  method: string,
): Promise<boolean> {
  if (method === "S256") return (await s256Challenge(verifier)) === challenge
  if (method === "plain") return verifier === challenge
  return false
}
