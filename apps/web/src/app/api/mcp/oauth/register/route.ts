import { createOAuthClient } from "@openremote/db"
import { newId } from "@openremote/protocol"
import { NextResponse } from "next/server"
import { z } from "zod"
import { badRequest } from "../../../../../lib/api/respond"

/**
 * Dynamic Client Registration (RFC 7591). Any MCP client can self-register its
 * redirect URIs and receive a `client_id`. We register PUBLIC clients only (no
 * secret) — the flow is secured by PKCE, which is the right model for native/app
 * clients like Claude and ChatGPT that can't keep a secret.
 */
const Body = z.object({
  redirect_uris: z.array(z.string().url()).min(1),
  client_name: z.string().max(200).optional(),
  // Accepted and ignored (clients send these; we don't need them for public+PKCE).
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
})

export async function POST(req: Request) {
  let json: unknown
  try {
    json = await req.json()
  } catch {
    return badRequest("invalid JSON body")
  }
  const parsed = Body.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: "redirect_uris is required" },
      { status: 400 },
    )
  }

  const clientId = `mcp_${newId().replace(/-/g, "")}`
  await createOAuthClient({
    clientId,
    clientName: parsed.data.client_name ?? null,
    redirectUris: parsed.data.redirect_uris,
  })

  // RFC 7591 registration response for a public client.
  return NextResponse.json(
    {
      client_id: clientId,
      client_name: parsed.data.client_name,
      redirect_uris: parsed.data.redirect_uris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { status: 201 },
  )
}
