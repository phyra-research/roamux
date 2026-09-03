import { withUser } from "../../../lib/api/handler"
import { ok } from "../../../lib/api/respond"

/** GET /api/me — the current authenticated user (401 if not signed in). */
export const GET = withUser(async (_req, user) => {
  return ok({ user: { id: user.id, email: user.email } })
})
