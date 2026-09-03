import { createDeviceAuth } from "@openremote/db"
import { z } from "zod"
import { randomSecret, userCode } from "../../../../lib/api/codes"
import { badRequest, ok } from "../../../../lib/api/respond"

/**
 * POST /api/device/start — begin `openremote login`. No auth: the daemon has no
 * session yet. Returns a device_code (the daemon polls with) and a user_code
 * (the human types in the browser). Env-driven base URL keeps it host-agnostic.
 */
const Body = z.object({
  hostName: z.string().min(1).max(200),
  platform: z.string().max(100).optional(),
})

export async function POST(req: Request) {
  let json: unknown
  try {
    json = await req.json()
  } catch {
    return badRequest("invalid JSON body")
  }
  const parsed = Body.safeParse(json)
  if (!parsed.success) return badRequest("hostName is required")

  const deviceCode = randomSecret()
  const code = userCode()
  await createDeviceAuth({
    deviceCode,
    userCode: code,
    hostName: parsed.data.hostName,
    platform: parsed.data.platform ?? null,
  })

  const base = process.env.OPENREMOTE_WEB_URL ?? "http://localhost:3000"
  return ok({
    deviceCode,
    userCode: code,
    verificationUri: `${base}/link`,
    verificationUriComplete: `${base}/link?code=${encodeURIComponent(code)}`,
    pollIntervalMs: 2000,
    expiresInMs: 10 * 60 * 1000,
  })
}
