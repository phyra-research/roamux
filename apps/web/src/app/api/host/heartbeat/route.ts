import { hostCredentialIsValid, updateHostStatus } from "@openremote/db"
import { z } from "zod"
import { hashSecret } from "../../../../lib/api/codes"
import { badRequest, ok, unauthorized } from "../../../../lib/api/respond"

/**
 * POST /api/host/heartbeat — the daemon reports it's online. Authenticated by
 * the host credential (hostId + secret) it got from `openremote login`, NOT a
 * user session — the host has no browser. Updates hosts.status so the account
 * machine list shows the green dot.
 */
const Body = z.object({
  hostId: z.string(),
  hostSecret: z.string(),
  status: z.enum(["online", "offline", "degraded"]).optional(),
})

export async function POST(req: Request) {
  let json: unknown
  try {
    json = await req.json()
  } catch {
    return badRequest("invalid JSON body")
  }
  const parsed = Body.safeParse(json)
  if (!parsed.success) return badRequest("hostId + hostSecret required")

  const valid = await hostCredentialIsValid(parsed.data.hostId, hashSecret(parsed.data.hostSecret))
  if (!valid) return unauthorized("invalid host credential")

  await updateHostStatus(parsed.data.hostId, parsed.data.status ?? "online")
  return ok({ status: parsed.data.status ?? "online" })
}
