import { NextResponse } from "next/server"

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728). MCP clients fetch this from
 * the resource server (the /api/mcp endpoint) to learn which authorization
 * server protects it. Here the resource and the auth server are the same origin.
 */
export function GET(req: Request) {
  const origin = new URL(req.url).origin
  return NextResponse.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
  })
}
