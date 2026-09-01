import { z } from "zod"

/**
 * RemoteCommand — the *only* things a remote client is allowed to ask a host to
 * do. This is the entire remote-control surface. Adding a capability means
 * adding a variant here (and a matching handler in the host) — there is no
 * generic "run this" escape hatch, by design (see CLAUDE.md §3).
 */
export const RemoteCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("prompt.send"),
    sessionId: z.string(),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("session.abort"),
    sessionId: z.string(),
  }),
  z.object({
    type: z.literal("permission.respond"),
    sessionId: z.string(),
    permissionId: z.string(),
    response: z.enum(["allow", "deny"]),
  }),
  z.object({
    type: z.literal("session.create"),
    projectPath: z.string(),
  }),
  z.object({
    // Ask the host to (re)send its current session list. Cheap, idempotent.
    type: z.literal("sessions.list"),
  }),
])

export type RemoteCommand = z.infer<typeof RemoteCommandSchema>
export type RemoteCommandType = RemoteCommand["type"]
