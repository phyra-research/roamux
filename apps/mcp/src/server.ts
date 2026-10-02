import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { RoamuxClient } from "./roamux-client.js"
import { TOOLS } from "./tools.js"

/**
 * Build an McpServer with the roamux tools registered against `client`.
 *
 * Transport-agnostic on purpose: the stdio entry (`index.ts`, v1) and the
 * production HTTP route (in apps/web — remote MCP with Supabase-delegated OAuth)
 * both call this with a `RoamuxClient` and then attach their own transport. The
 * tool surface and wire behavior are identical either way, so remote/prod is
 * purely additive — a new front door onto the same tools.
 */
export function buildServer(client: RoamuxClient): McpServer {
  const server = new McpServer({ name: "roamux", version: "0.1.0" })

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema.shape,
      },
      async (args: Record<string, unknown>) => {
        try {
          return await tool.handle(client, args)
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `roamux error: ${(err as Error).message}` }],
            isError: true,
          }
        }
      },
    )
  }

  return server
}
