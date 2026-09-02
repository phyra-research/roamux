import type { UserRow } from "@openremote/db"
import type { NextResponse } from "next/server"
import { AuthError, requireUser } from "./auth.js"
import { serverError, unauthorized } from "./respond.js"

/**
 * Wrap an authenticated route handler: resolves the user, and turns AuthError
 * into 401 and any other throw into 500. Handlers get a trusted `user` and can
 * focus on the domain logic.
 */
export function withUser(
  handler: (req: Request, user: UserRow, ctx: RouteContext) => Promise<NextResponse>,
) {
  return async (req: Request, ctx: RouteContext): Promise<NextResponse> => {
    let user: UserRow
    try {
      user = await requireUser(req)
    } catch (err) {
      if (err instanceof AuthError) return unauthorized(err.message)
      return serverError()
    }
    try {
      return await handler(req, user, ctx)
    } catch (err) {
      // why: never leak internals to the client; log server-side for debugging.
      console.error("[api] handler error:", err)
      return serverError()
    }
  }
}

/** Next.js route context (dynamic params are async in Next 15). */
export type RouteContext = { params: Promise<Record<string, string>> }
