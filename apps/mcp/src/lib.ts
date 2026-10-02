/**
 * Library surface of @openremote/mcp — the transport-agnostic pieces (tools +
 * client core) that both the stdio server (index.ts) and the remote HTTP route
 * (apps/web /api/mcp) build on. Importers get the tool definitions and the
 * RoamuxClient without pulling in the stdio entrypoint.
 */
export { RoamuxClient, ablyTransportFactory } from "./roamux-client.js"
export type { RoamuxClientOptions, TransportFactory } from "./roamux-client.js"
export { RoamuxRestClient } from "./roamux-rest-client.js"
export type { RoamuxRestClientOptions } from "./roamux-rest-client.js"
export type { RoamuxClientLike } from "./client-interface.js"
export { TOOLS } from "./tools.js"
export type { ToolDef, ToolResult } from "./tools.js"
export { buildServer } from "./server.js"
