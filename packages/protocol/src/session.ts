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

/**
 * An approved project on a host, as surfaced to clients. Clients reference `id`
 * only; the daemon maps it to a local absolute path (never sent over the wire).
 */
export const ProjectInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
})
export type ProjectInfo = z.infer<typeof ProjectInfoSchema>

/** An installed harness on a host (the "Agent" choices in the New Session UI). */
export const HarnessInfoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
})
export type HarnessInfo = z.infer<typeof HarnessInfoSchema>

/** A host's capabilities: what a client may pick when creating a session. */
export const HostCapabilitiesSchema = z.object({
  projects: z.array(ProjectInfoSchema),
  harnesses: z.array(HarnessInfoSchema),
})
export type HostCapabilities = z.infer<typeof HostCapabilitiesSchema>

/** Presence/identity of a host machine as shown in the client's machine list. */
export const HostInfoSchema = z.object({
  deviceId: z.string(),
  name: z.string(),
  online: z.boolean(),
  adapter: z.string(),
  activeSessions: z.number().int().nonnegative().default(0),
})

export type HostInfo = z.infer<typeof HostInfoSchema>
