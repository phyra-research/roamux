import { consumeDeviceAuth, getDeviceAuthByDeviceCode } from "@openremote/db"
import { z } from "zod"
import { badRequest, ok } from "../../../../lib/api/respond"

/**
 * POST /api/device/poll — the daemon polls with its device_code. No auth (the
 * device_code IS the secret). Returns:
 *   { status: "pending" }                        → keep polling
 *   { status: "approved", hostId, hostSecret }   → done; store credentials
 *   { status: "expired" | "unknown" }            → stop
 * The host secret is returned exactly once, then cleared (consumed).
 */
const Body = z.object({ deviceCode: z.string().min(1) })

export async function POST(req: Request) {
  let json: unknown
  try {
    json = await req.json()
  } catch {
    return badRequest("invalid JSON body")
  }
  const parsed = Body.safeParse(json)
  if (!parsed.success) return badRequest("deviceCode is required")

  const row = await getDeviceAuthByDeviceCode(parsed.data.deviceCode)
  if (!row) return ok({ status: "unknown" })
  if (row.status === "consumed") return ok({ status: "unknown" })
  if (row.expiresAt.getTime() < Date.now() && row.status === "pending") {
    return ok({ status: "expired" })
  }
  if (row.status === "pending") return ok({ status: "pending" })

  // approved → hand the secret to the daemon once, then consume it.
  if (row.status === "approved" && row.hostId && row.hostSecret) {
    const { hostId, hostSecret } = row
    await consumeDeviceAuth(parsed.data.deviceCode)
    return ok({ status: "approved", hostId, hostSecret })
  }
  return ok({ status: "unknown" })
}
