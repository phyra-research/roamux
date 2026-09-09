import { renameHost } from "@openremote/db"
import { z } from "zod"
import { withUser } from "../../../../lib/api/handler"
import { notFound, ok, parseBody } from "../../../../lib/api/respond"

const RenameHostBody = z.object({ name: z.string().min(1).max(200) })

/**
 * PATCH /api/hosts/:id — rename a host the current user owns. The name is set
 * once at link time and goes stale; this lets the owner relabel it. Ownership is
 * enforced in the repo query, so another user's id can't rename it.
 */
export const PATCH = withUser(async (req, user, ctx) => {
  const { id } = await ctx.params
  const parsed = await parseBody(req, RenameHostBody)
  if (!parsed.ok) return parsed.response
  const host = await renameHost(id, user.id, parsed.value.name)
  // Not owned or nonexistent → 404 (don't reveal which).
  if (!host) return notFound("host not found")
  return ok({ host })
})
