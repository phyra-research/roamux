import { ok } from "../../../lib/api/respond"

/** GET /api/health — liveness probe for deploy checks. No auth, no DB. */
export function GET() {
  return ok({ status: "up", service: "openremote-api" })
}
