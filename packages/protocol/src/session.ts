import { z } from "zod"

/** A coding-agent session as surfaced to remote clients (runtime-agnostic). */
export const AgentSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectPath: z.string().optional(),
  /** Free-form "Qwen / OpenCode" style label for the UI. */
  model: z.string().optional(),
  status: z.enum(["idle", "running", "waiting", "error"]).default("idle"),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
})

export type AgentSession = z.infer<typeof AgentSessionSchema>

/** Presence/identity of a host machine as shown in the client's machine list. */
export const HostInfoSchema = z.object({
  deviceId: z.string(),
  name: z.string(),
  online: z.boolean(),
  adapter: z.string(),
  activeSessions: z.number().int().nonnegative().default(0),
})

export type HostInfo = z.infer<typeof HostInfoSchema>
