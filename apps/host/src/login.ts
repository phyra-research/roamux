import { hostname } from "node:os"
import type { HostStore } from "./store.js"

/**
 * `openremote login` — device-authorization flow. Prints a short code, asks the
 * user to approve it in their browser, polls until approved, then persists the
 * account link (hostId + host secret) to the local store. No secret is ever
 * pasted by the user (Beta §10.2).
 */
export async function runLogin(opts: {
  apiUrl: string
  hostName: string
  store: HostStore
  log?: (msg: string) => void
}): Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(m))
  const api = opts.apiUrl.replace(/\/$/, "")

  const startRes = await fetch(`${api}/api/device/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hostName: opts.hostName,
      platform: `${process.platform}-${process.arch}`,
    }),
  })
  const start = (await startRes.json()) as {
    ok?: boolean
    data?: {
      deviceCode: string
      userCode: string
      verificationUri: string
      verificationUriComplete: string
      pollIntervalMs: number
      expiresInMs: number
    }
    error?: string
  }
  if (!startRes.ok || !start.ok || !start.data) {
    throw new Error(`login start failed: ${start.error ?? startRes.status}`)
  }
  const {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete,
    pollIntervalMs,
    expiresInMs,
  } = start.data

  log("")
  log("  Link this device to your OpenRemote account:")
  log("")
  log(`    1. Open:  ${verificationUri}`)
  log(`    2. Enter: ${userCode}`)
  log("")
  log(`  Or open directly: ${verificationUriComplete}`)
  log("")
  log("  Waiting for approval…")

  const deadline = Date.now() + expiresInMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs))
    const pollRes = await fetch(`${api}/api/device/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode }),
    })
    const poll = (await pollRes.json()) as {
      data?: { status: string; hostId?: string; hostSecret?: string }
    }
    const status = poll.data?.status
    if (status === "approved" && poll.data?.hostId && poll.data?.hostSecret) {
      opts.store.saveAccount({
        apiUrl: api,
        hostId: poll.data.hostId,
        hostSecret: poll.data.hostSecret,
      })
      log("")
      log("  ✓ Device linked. You can start the host with `openremote host`.")
      return
    }
    if (status === "expired" || status === "unknown") {
      throw new Error("login code expired — run `openremote login` again")
    }
    // status === "pending" → keep polling
  }
  throw new Error("login timed out — run `openremote login` again")
}

export function defaultHostName(): string {
  return process.env.HOST_NAME ?? hostname()
}
