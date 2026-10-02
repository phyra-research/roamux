import { RoamuxClient, TOOLS, ablyTransportFactory } from "@openremote/mcp/lib"
import { LOCAL_USER } from "@openremote/protocol"
import { NextResponse } from "next/server"
import { mcpTokenSecret, verifyAccessToken } from "../../../lib/mcp/token"

/**
 * Remote MCP endpoint (Streamable HTTP, JSON-RPC over POST). This is the "second
 * front door" to roamux: any MCP client (Claude mobile/desktop, ChatGPT, …) that
 * completed the OAuth flow presents its roamux access token here and drives the
 * user's hosts through the SAME tools the stdio server exposes (@openremote/mcp).
 *
 * We implement the MCP JSON-RPC methods directly (initialize / tools/list /
 * tools/call) rather than bridging the SDK's Node-stream transport into the
 * App Router — the surface is small, fully in our control, and avoids
 * IncomingMessage/ServerResponse shims in a Fetch-based route.
 *
 * Isolation: the Bearer token resolves to exactly one roamux userId; the
 * RoamuxClient is constructed with THAT userId, so every Ably channel it builds
 * is `openremote:user:{thatUserId}:*`. A token can only ever reach its own user's
 * hosts (CLAUDE.md §3), same guarantee as the browser client.
 */

const PROTOCOL_VERSION = "2025-06-18"

type JsonRpcReq = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: unknown }

function rpcResult(id: string | number | null | undefined, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result })
}
function rpcError(
  id: string | number | null | undefined,
  code: number,
  message: string,
  status = 200,
) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status })
}

/** 401 with the RFC 9728 pointer so clients know where to authenticate. */
function unauthorized(req: Request) {
  const origin = new URL(req.url).origin
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      },
    },
  )
}

async function resolveUserId(req: Request): Promise<string | null> {
  const secret = mcpTokenSecret()
  if (!secret) return null
  const auth = req.headers.get("authorization") ?? ""
  const m = /^Bearer\s+(.+)$/i.exec(auth)
  if (!m) return null
  return verifyAccessToken(m[1]!, secret)
}

function makeClient(userId: string): RoamuxClient {
  const key = process.env.ABLY_API_KEY
  if (!key) throw new Error("ABLY_API_KEY is not set")
  // Server-side client: it holds the key, but every channel is scoped to the
  // Bearer-verified userId, so it can only reach that user's hosts.
  return new RoamuxClient({
    userId,
    activityWindowMs: 2500,
    transportFactory: ablyTransportFactory(key, `mcp:${userId}`),
  })
}

export async function POST(req: Request) {
  const userId = await resolveUserId(req)
  if (!userId) return unauthorized(req)

  let body: JsonRpcReq
  try {
    body = (await req.json()) as JsonRpcReq
  } catch {
    return rpcError(null, -32700, "parse error")
  }
  const { id, method, params } = body

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "roamux", version: "0.1.0" },
      })

    case "notifications/initialized":
      // Notification — no response expected.
      return new NextResponse(null, { status: 202 })

    case "tools/list":
      return rpcResult(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: zodObjectToJsonSchema(t.inputSchema),
        })),
      })

    case "tools/call": {
      const p = (params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
      const tool = TOOLS.find((t) => t.name === p.name)
      if (!tool) return rpcError(id, -32602, `unknown tool: ${p.name}`)
      const parsed = tool.inputSchema.safeParse(p.arguments ?? {})
      if (!parsed.success) {
        return rpcError(id, -32602, parsed.error.issues.map((i) => i.message).join("; "))
      }
      try {
        const client = makeClient(userId)
        const result = await tool.handle(client, parsed.data)
        return rpcResult(id, result)
      } catch (err) {
        return rpcResult(id, {
          content: [{ type: "text", text: `roamux error: ${(err as Error).message}` }],
          isError: true,
        })
      }
    }

    default:
      return rpcError(id, -32601, `method not found: ${method}`)
  }
}

/** GET is used by some clients to probe; point them at auth. */
export async function GET(req: Request) {
  const userId = await resolveUserId(req)
  if (!userId) return unauthorized(req)
  return NextResponse.json({ name: "roamux", version: "0.1.0", protocolVersion: PROTOCOL_VERSION })
}

// why: the dev-auth fallback uses LOCAL_USER elsewhere; referenced here to keep
// the import meaningful if token minting is disabled in local dev.
void LOCAL_USER

/**
 * Minimal Zod-object → JSON Schema for tool inputs. Covers the shapes our tools
 * use (string, enum, optional, describe). Not a general converter — just enough
 * for the MCP `inputSchema` advertisement.
 */
function zodObjectToJsonSchema(schema: {
  shape: Record<string, unknown>
}): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, raw] of Object.entries(schema.shape)) {
    const def = (raw as { _def?: Record<string, unknown> })._def ?? {}
    const { jsonType, optional, description, enumValues } = describeZod(def)
    const prop: Record<string, unknown> = { type: jsonType }
    if (description) prop.description = description
    if (enumValues) prop.enum = enumValues
    properties[key] = prop
    if (!optional) required.push(key)
  }
  return { type: "object", properties, required }
}

function describeZod(def: Record<string, unknown>): {
  jsonType: string
  optional: boolean
  description?: string
  enumValues?: string[]
} {
  let cur = def
  let optional = false
  let description: string | undefined
  // Unwrap ZodOptional / ZodDefault, capturing descriptions along the way.
  for (let i = 0; i < 5; i++) {
    const tn = cur.typeName as string | undefined
    if (cur.description) description = cur.description as string
    if (tn === "ZodOptional" || tn === "ZodDefault") {
      optional = true
      cur = ((cur.innerType as { _def?: Record<string, unknown> })?._def ?? {}) as Record<
        string,
        unknown
      >
      continue
    }
    if (tn === "ZodEnum") {
      return { jsonType: "string", optional, description, enumValues: cur.values as string[] }
    }
    break
  }
  return { jsonType: "string", optional, description }
}
