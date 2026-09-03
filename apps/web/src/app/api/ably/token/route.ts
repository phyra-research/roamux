import { NextResponse } from "next/server"
import {
  type AblyCapability,
  ablyConfigured,
  createScopedTokenRequest,
} from "../../../../lib/api/ably"
import { withUser } from "../../../../lib/api/handler"
import { fail } from "../../../../lib/api/respond"

/**
 * POST /api/ably/token — mint a short-lived, capability-scoped Ably TokenRequest
 * for the authenticated user's browser. The browser exchanges it with Ably; it
 * never sees the raw key.
 *
 * Scope: only channels under this user's namespace, so a token can't reach any
 * other user's hosts/sessions (Beta §11 cross-user isolation). The `local`
 * userId is used until the pairing-token channels are folded into user scoping
 * (Phase 1 → Phase 2 transition); we grant the pairing namespace too so the
 * current client can still reach a paired host during that transition.
 */
export const POST = withUser(async (_req, user) => {
  if (!ablyConfigured()) {
    return fail(503, "ably not configured")
  }

  const capability: AblyCapability = {
    // The user's own control + session channels (all their hosts/sessions).
    // NOTE: Ably's `*` is greedy across ':' separators, so `user:{id}:*` covers
    // every nested channel under the user. `**` does NOT work here (verified
    // against Ably) — it matches nothing.
    [`openremote:user:${user.id}:*`]: ["subscribe", "publish", "presence"],
    // Transitional: the pre-accounts pairing rendezvous namespace.
    "openremote:pair:*": ["subscribe", "publish", "presence"],
  }

  const tokenRequest = await createScopedTokenRequest(`client:${user.id}`, capability)
  // Return the raw TokenRequest shape Ably's client expects from authCallback.
  return NextResponse.json(tokenRequest)
})
