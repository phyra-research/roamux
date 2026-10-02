import { NextResponse } from "next/server"

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414). MCP clients (Claude,
 * ChatGPT, Cursor, …) fetch this to auto-discover the authorize/token/register
 * endpoints — it's what makes the connector flow work without per-client config.
 *
 * The `origin` is taken from the request so it is correct on any host (localhost,
 * preview, or remote.phyra.ai) without hardcoding a URL.
 */
export function GET(req: Request) {
  const origin = new URL(req.url).origin
  return NextResponse.json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  })
}
