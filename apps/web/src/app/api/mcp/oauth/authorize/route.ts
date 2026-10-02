import { createOAuthCode, getOAuthClient } from "@openremote/db"
import { newId } from "@openremote/protocol"
import { NextResponse } from "next/server"
import { requireUser } from "../../../../../lib/api/auth"
import { AuthError } from "../../../../../lib/api/auth"

/**
 * OAuth 2.1 authorization endpoint for the MCP flow.
 *
 * Steps:
 *  1. Validate the client + redirect_uri + PKCE challenge.
 *  2. Require a logged-in roamux user — DELEGATED to the existing Supabase
 *     session. If the user isn't logged in, bounce to /login?next=<this URL> so
 *     they sign in (GitHub via Supabase) and come right back.
 *  3. Issue a one-time authorization code bound to the user + PKCE challenge and
 *     redirect back to the client's redirect_uri with code + state.
 *
 * We never show the client an Ably key or the user's Supabase token — only a
 * short-lived code it exchanges at /token for a roamux access token.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const p = url.searchParams
  const clientId = p.get("client_id")
  const redirectUri = p.get("redirect_uri")
  const responseType = p.get("response_type")
  const codeChallenge = p.get("code_challenge")
  const codeChallengeMethod = p.get("code_challenge_method") ?? "S256"
  const state = p.get("state")

  // Basic request validation (before we trust anything).
  if (responseType !== "code") {
    return NextResponse.json({ error: "unsupported_response_type" }, { status: 400 })
  }
  if (!clientId || !redirectUri || !codeChallenge) {
    return NextResponse.json(
      {
        error: "invalid_request",
        error_description: "missing client_id/redirect_uri/code_challenge",
      },
      { status: 400 },
    )
  }
  if (codeChallengeMethod !== "S256") {
    return NextResponse.json(
      { error: "invalid_request", error_description: "only S256 PKCE is supported" },
      { status: 400 },
    )
  }

  const client = await getOAuthClient(clientId)
  if (!client) {
    return NextResponse.json({ error: "invalid_client" }, { status: 400 })
  }
  // The redirect_uri MUST exactly match one the client registered (anti-spoofing).
  if (!client.redirectUris.includes(redirectUri)) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "redirect_uri not registered" },
      { status: 400 },
    )
  }

  // Require a roamux user via the existing Supabase session. If absent, send the
  // user to login and return to this exact authorize URL afterwards.
  let userId: string
  try {
    const user = await requireUser(req)
    userId = user.id
  } catch (err) {
    if (err instanceof AuthError) {
      const next = `${url.pathname}${url.search}`
      const login = new URL("/login", url.origin)
      login.searchParams.set("next", next)
      return NextResponse.redirect(login)
    }
    throw err
  }

  // Issue a one-time code bound to the user + PKCE challenge.
  const code = newId().replace(/-/g, "")
  await createOAuthCode({
    code,
    clientId,
    userId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    state,
  })

  // Redirect back to the client with the code (and state, echoed for CSRF).
  const back = new URL(redirectUri)
  back.searchParams.set("code", code)
  if (state) back.searchParams.set("state", state)
  return NextResponse.redirect(back)
}
