import { z } from "zod"
import type { RoamuxClient } from "./roamux-client.js"

/**
 * MCP tool definitions for roamux. Each tool is a thin wrapper that validates
 * input with Zod and calls one high-level `RoamuxClient` operation, which in
 * turn sends exactly one roamux `RemoteCommand` on the wire. There is no generic
 * "run anything" tool — the surface mirrors the closed `RemoteCommand` union, so
 * the security posture (CLAUDE.md §3) is unchanged: an MCP client can do only
 * what a browser client can do.
 *
 * `hostId` is supplied by the caller (it comes from the user's roamux hosts list
 * in the web UI). v1 does not add a host-discovery API; that is a follow-up.
 */

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean }

export type ToolDef = {
  name: string
  description: string
  inputSchema: z.ZodObject<z.ZodRawShape>
  handle: (client: RoamuxClient, args: Record<string, unknown>) => Promise<ToolResult>
}

const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
})

const hostId = z
  .string()
  .describe("The roamux host id (from your machines list in the roamux web UI).")
const sessionId = z.string().describe("The session id (from list_sessions or start_session).")

export const TOOLS: ToolDef[] = [
  {
    name: "roamux_list_sessions",
    description: "List the agent sessions currently on a roamux host.",
    inputSchema: z.object({ hostId }),
    handle: async (c, a) => ok(await c.listSessions(a.hostId as string)),
  },
  {
    name: "roamux_list_projects",
    description:
      "List a host's approved projects and installed agent harnesses — the valid inputs for start_session.",
    inputSchema: z.object({ hostId }),
    handle: async (c, a) => ok(await c.listProjects(a.hostId as string)),
  },
  {
    name: "roamux_start_session",
    description:
      "Start a new agent session on a host for an approved project. harnessType is one of the host's installed harnesses (see list_projects).",
    inputSchema: z.object({
      hostId,
      projectId: z.string().describe("An APPROVED project id on the host (see list_projects)."),
      harnessType: z
        .string()
        .describe("Which installed agent to use, e.g. 'claude-code', 'opencode', 'codex'."),
      initialPrompt: z.string().optional().describe("Optional first instruction for the agent."),
    }),
    handle: async (c, a) =>
      ok(
        await c.startSession(
          a.hostId as string,
          a.projectId as string,
          a.harnessType as string,
          a.initialPrompt as string | undefined,
        ),
      ),
  },
  {
    name: "roamux_send_prompt",
    description:
      "Send an instruction to a running session. Returns the activity seen in a short window; poll get_activity for more as the agent works.",
    inputSchema: z.object({
      hostId,
      sessionId,
      text: z.string().min(1).describe("The instruction."),
    }),
    handle: async (c, a) =>
      ok(await c.sendPrompt(a.hostId as string, a.sessionId as string, a.text as string)),
  },
  {
    name: "roamux_get_activity",
    description:
      "Poll a session's recent activity (read-only). Call repeatedly to follow a long-running agent until you see an 'agent.completed' or 'agent.waiting' event.",
    inputSchema: z.object({ hostId, sessionId }),
    handle: async (c, a) => ok(await c.getActivity(a.hostId as string, a.sessionId as string)),
  },
  {
    name: "roamux_stop_session",
    description: "Stop/abort a running session.",
    inputSchema: z.object({ hostId, sessionId }),
    handle: async (c, a) => {
      await c.stopSession(a.hostId as string, a.sessionId as string)
      return ok({ stopped: true, sessionId: a.sessionId })
    },
  },
  {
    name: "roamux_respond_permission",
    description:
      "Approve or deny a permission the agent is waiting on (e.g. a file edit or command). Use the permissionId from a 'permission.requested' activity event.",
    inputSchema: z.object({
      hostId,
      sessionId,
      permissionId: z.string().describe("The permissionId from the permission.requested event."),
      response: z.enum(["allow", "deny"]),
    }),
    handle: async (c, a) =>
      ok(
        await c.respondPermission(
          a.hostId as string,
          a.sessionId as string,
          a.permissionId as string,
          a.response as "allow" | "deny",
        ),
      ),
  },
]
