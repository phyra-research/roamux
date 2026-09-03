import {
  approveDeviceAuth,
  createHost,
  createHostCredential,
  getDeviceAuthByUserCode,
} from "@openremote/db"
import { z } from "zod"
import { hashSecret, randomSecret } from "../../../../lib/api/codes"
import { withUser } from "../../../../lib/api/handler"
import { badRequest, notFound, ok } from "../../../../lib/api/respond"

/**
 * POST /api/device/approve — the logged-in user approves a pending device code
 * from their browser. Creates the HostRecord under their account, mints a host
 * credential (stored hashed; raw handed to the daemon via poll), and binds the
 * device request. Auth required — this is the human granting access.
 */
const Body = z.object({ userCode: z.string().min(1) })

export const POST = withUser(async (req, user) => {
  const parsed = await (async () => {
    try {
      return Body.safeParse(await req.json())
    } catch {
      return null
    }
  })()
  if (!parsed) return badRequest("invalid JSON body")
  if (!parsed.success) return badRequest("userCode is required")

  const pending = await getDeviceAuthByUserCode(parsed.data.userCode.trim().toUpperCase())
  if (!pending) return notFound("code not found or expired")

  const host = await createHost({
    userId: user.id,
    name: pending.hostName,
    platform: pending.platform,
  })
  const hostSecret = randomSecret()
  await createHostCredential(host.id, hashSecret(hostSecret))

  const bound = await approveDeviceAuth(
    parsed.data.userCode.trim().toUpperCase(),
    user.id,
    host.id,
    hostSecret,
  )
  if (!bound) return notFound("code not found or expired")

  return ok({ host: { id: host.id, name: host.name } })
})
