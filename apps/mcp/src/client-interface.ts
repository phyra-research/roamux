import type { AgentEvent, AgentSession, HostCapabilities } from "@openremote/protocol"

/**
 * The operation surface the MCP tools depend on. Both `RoamuxClient` (Realtime,
 * for the stdio server / long-lived processes) and `RoamuxRestClient` (REST, for
 * the serverless /api/mcp route) implement it, so the tools are transport-
 * agnostic and the route can pick the right client for its environment.
 */
export interface RoamuxClientLike {
  listSessions(hostId: string): Promise<AgentSession[]>
  listProjects(hostId: string): Promise<HostCapabilities | null>
  startSession(
    hostId: string,
    projectId: string,
    harnessType: string,
    initialPrompt?: string,
  ): Promise<AgentSession[]>
  sendPrompt(hostId: string, sessionId: string, text: string): Promise<AgentEvent[]>
  getActivity(hostId: string, sessionId: string): Promise<AgentEvent[]>
  stopSession(hostId: string, sessionId: string): Promise<void>
  respondPermission(
    hostId: string,
    sessionId: string,
    permissionId: string,
    response: "allow" | "deny",
  ): Promise<AgentEvent[]>
}
