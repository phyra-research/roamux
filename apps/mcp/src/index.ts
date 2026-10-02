#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { loadConfig } from "./config.js"
import { RoamuxClient, ablyTransportFactory } from "./roamux-client.js"
import { buildServer } from "./server.js"

/**
 * roamux MCP server — v1, stdio.
 *
 * Exposes roamux's control surface as MCP tools so any MCP client (Claude
 * Desktop today) can drive the user's hosts. This v1 runs locally over stdio and
 * authenticates with the shared Ably key (self-host / dev model). The production
 * path is the SAME tools behind an HTTP transport + Supabase-delegated OAuth,
 * served as a route in apps/web — see server.ts.
 *
 * Add to a client (e.g. Claude Desktop mcpServers):
 *   { "command": "roamux-mcp", "env": { "ABLY_API_KEY": "..." } }
 */
async function main(): Promise<void> {
  const config = loadConfig()
  const client = new RoamuxClient({
    userId: config.userId,
    activityWindowMs: config.activityWindowMs,
    transportFactory: ablyTransportFactory(config.ablyApiKey, `mcp:${config.userId}`),
  })
  const server = buildServer(client)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // stdio keeps the process alive; nothing else to do.
}

main().catch((err) => {
  // stderr only — stdout is the MCP protocol channel and must stay clean.
  console.error(`roamux-mcp failed to start: ${(err as Error).message}`)
  process.exit(1)
})
