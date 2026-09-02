import { revokeHost } from "@openremote/db"
import { withUser } from "../../../../../lib/api/handler"
import { notFound, ok } from "../../../../../lib/api/respond"

/**
 * POST /api/hosts/:id/revoke — revoke a host the current user owns. Revoked
 * hosts can no longer obtain transport credentials or accept new sessions.
 * Ownership is enforced in the repo query, so another user's id can't revoke it.
 */
export const POST = withUser(async (_req, user, ctx) => {
  const { id } = await ctx.params
  const revoked = await revokeHost(id, user.id)
  // Not owned, already revoked, or nonexistent → 404 (don't reveal which).
  if (!revoked) return notFound("host not found or already revoked")
  return ok({ revoked: true })
})
