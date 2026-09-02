import { createHost, listHostsForUser } from "@openremote/db"
import { z } from "zod"
import { withUser } from "../../../lib/api/handler"
import { ok, parseBody } from "../../../lib/api/respond"

/** GET /api/hosts — list the current user's hosts. */
export const GET = withUser(async (_req, user) => {
  const hosts = await listHostsForUser(user.id)
  return ok({ hosts })
})

const CreateHostBody = z.object({
  name: z.string().min(1).max(200),
  platform: z.string().max(100).optional(),
  daemonVersion: z.string().max(100).optional(),
  capabilities: z.record(z.unknown()).optional(),
})

/** POST /api/hosts — register a new host for the current user. */
export const POST = withUser(async (req, user) => {
  const parsed = await parseBody(req, CreateHostBody)
  if (!parsed.ok) return parsed.response
  const host = await createHost({ userId: user.id, ...parsed.value })
  return ok({ host }, { status: 201 })
})
