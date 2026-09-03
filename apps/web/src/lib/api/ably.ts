import * as Ably from "ably"

/**
 * Mint short-lived, capability-scoped Ably token requests server-side. The raw
 * ABLY_API_KEY lives ONLY here (server) — the browser and host never see it;
 * they receive a signed TokenRequest they exchange with Ably directly (Beta
 * §10.3). Capabilities are scoped to exactly the channels the caller may touch,
 * so a stolen token can't reach another user's/host's channels (Beta §11).
 */

let rest: Ably.Rest | null = null

function ablyRest(): Ably.Rest {
  if (rest) return rest
  const key = process.env.ABLY_API_KEY
  if (!key) throw new Error("ABLY_API_KEY is not set")
  rest = new Ably.Rest({ key })
  return rest
}

/** Whether Ably token minting is configured (server has a key). */
export function ablyConfigured(): boolean {
  return !!process.env.ABLY_API_KEY
}

/**
 * A capability map: channel name (or glob) → allowed operations. e.g.
 * `{ "openremote:pair:abc": ["subscribe", "publish", "presence"] }`.
 */
export type AblyCapability = Record<string, string[]>

/**
 * Create a signed TokenRequest scoped to `capability`, tied to `clientId`, with
 * a short TTL. Returned to the browser/host, which uses it to auth with Ably.
 */
export async function createScopedTokenRequest(
  clientId: string,
  capability: AblyCapability,
  ttlMs = 60 * 60 * 1000, // 1 hour
): Promise<Ably.TokenRequest> {
  return ablyRest().auth.createTokenRequest({
    clientId,
    capability: JSON.stringify(capability),
    ttl: ttlMs,
  })
}
