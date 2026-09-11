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
    // Create a daemon-owned session. Clients reference an APPROVED projectId and
    // a harnessType — never a filesystem path or shell string (Beta §13.2). The
    // daemon maps projectId → local path and validates the harness is installed.
    type: z.literal("session.create"),
    projectId: z.string(),
    harnessType: z.string(),
    initialPrompt: z.string().optional(),
  }),
  z.object({
    // Ask the host to (re)send its current session list. Cheap, idempotent.
    type: z.literal("sessions.list"),
  }),
  z.object({
    // Ask the host for the set of files the agent changed in this session. The
    // host replies with a `diff.snapshot` event on the session's channel.
    type: z.literal("diff.request"),
    sessionId: z.string(),
  }),
  z.object({
    // Ask the host to (re)send its approved projects + installed harnesses, so
    // the New Session UI can populate its pickers.
    type: z.literal("projects.list"),
  }),
])

export type RemoteCommand = z.infer<typeof RemoteCommandSchema>
export type RemoteCommandType = RemoteCommand["type"]
