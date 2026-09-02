import { z } from "zod"

/**
 * AgentEvent — the *normalized* view of anything a coding-agent runtime does.
 *
 * This is deliberately runtime-agnostic. OpenCode, OpenHands, Aider, etc. all
 * get mapped down into this small vocabulary by their AgentAdapter. The web UI
 * only ever renders these — it never sees a runtime-specific shape.
 */
export const AgentEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.started"),
    sessionId: z.string(),
  }),
  z.object({
    type: z.literal("assistant.delta"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("assistant.message"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("tool.started"),
    tool: z.string(),
    callId: z.string().optional(),
    input: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("tool.completed"),
    tool: z.string(),
    callId: z.string().optional(),
    output: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("terminal.output"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("file.changed"),
    path: z.string(),
  }),
  z.object({
    type: z.literal("permission.requested"),
    permissionId: z.string(),
    description: z.string(),
    tool: z.string().optional(),
    input: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("permission.resolved"),
    permissionId: z.string(),
    response: z.enum(["allow", "deny"]),
  }),
  z.object({
    type: z.literal("agent.waiting"),
  }),
  z.object({
    type: z.literal("agent.completed"),
  }),
  z.object({
    type: z.literal("agent.failed"),
    error: z.string(),
  }),
  // ── Run lifecycle (session vs run split, #9) ────────────────────────────────
  // A session is long-lived (host+project+harness); a run is one unit of work
  // inside it (usually one instruction). Run events carry the runId so a client
  // can group activity by run. These are ADDITIVE to the agent.* events above,
  // which the V0 UI still uses for session status.
  z.object({
    type: z.literal("run.started"),
    runId: z.string(),
  }),
  z.object({
    type: z.literal("run.completed"),
    runId: z.string(),
  }),
  z.object({
    type: z.literal("run.failed"),
    runId: z.string(),
    error: z.string(),
  }),
])

export type AgentEvent = z.infer<typeof AgentEventSchema>
export type AgentEventType = AgentEvent["type"]
