import { consumeOAuthCode } from "@openremote/db"
import { NextResponse } from "next/server"
import { verifyPkce } from "../../../../../lib/mcp/pkce"
import { mcpTokenSecret, signAccessToken } from "../../../../../lib/mcp/token"

/**
 * OAuth 2.1 token endpoint for the MCP flow. The client exchanges its one-time
 * authorization code + PKCE `code_verifier` for a roamux access token.
 *
 * Checks: the code must be valid/unconsumed/unexpired (consumed atomically here,
 * so it can never be replayed), the client_id + redirect_uri must match, and the
 * PKCE verifier must hash to the stored challenge. Only then do we mint a
 * short-lived roamux-signed access token carrying the userId.
 */
function err(error: string, description?: string, status = 400) {
  return NextResponse.json(
    { error, ...(description ? { error_description: description } : {}) },
    { status },
  )
}

export async function POST(req: Request) {
  const secret = mcpTokenSecret()
  if (!secret) return err("server_error", "MCP auth not configured", 503)

  // Token endpoint accepts form-encoded or JSON bodies (clients vary).
  let params: URLSearchParams
  const ct = req.headers.get("content-type") ?? ""
  if (ct.includes("application/json")) {
    try {
      const j = (await req.json()) as Record<string, string>
      params = new URLSearchParams(j)
    } catch {
      return err("invalid_request", "invalid JSON body")
    }
  } else {
    params = new URLSearchParams(await req.text())
  }

  if (params.get("grant_type") !== "authorization_code") {
    return err("unsupported_grant_type")
  }
  const code = params.get("code")
  const clientId = params.get("client_id")
  const redirectUri = params.get("redirect_uri")
  const verifier = params.get("code_verifier")
  if (!code || !clientId || !redirectUri || !verifier) {
    return err("invalid_request", "missing code/client_id/redirect_uri/code_verifier")
  }

  // Atomically consume the code (single-use).
  const row = await consumeOAuthCode(code)
  if (!row) return err("invalid_grant", "code invalid, expired, or already used")
  if (row.clientId !== clientId) return err("invalid_grant", "client mismatch")
  if (row.redirectUri !== redirectUri) return err("invalid_grant", "redirect_uri mismatch")

  const pkceOk = await verifyPkce(verifier, row.codeChallenge, row.codeChallengeMethod)
  if (!pkceOk) return err("invalid_grant", "PKCE verification failed")

  const accessToken = await signAccessToken(row.userId, secret)
  return NextResponse.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
  })
}
