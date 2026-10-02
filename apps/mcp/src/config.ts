import { LOCAL_USER } from "@openremote/protocol"

/**
 * MCP server config — env-driven, like the rest of roamux (never hardcode keys
 * or URLs). The MCP server is just another roamux *client*: it connects to the
 * same Ably channels the web UI uses and sends the same `RemoteCommand`s.
 *
 * Auth model (v1): a shared Ably API key, exactly like the host and local-dev
 * client. This keeps the first cut simple and self-host-friendly. Production
 * remote-MCP with per-user OAuth → scoped-token auth is a follow-up (the
 * transport already supports `authCallback`; see AblyTransportOptions).
 */
export type McpConfig = {
  /** Ably API key (the MCP server is a trusted, server-side client). */
  ablyApiKey: string
  /** Which user's channel namespace to operate in (defaults to the dev user). */
  userId: string
  /**
   * How long to collect events after a command before returning, in ms. Agent
   * runs stream over time; tools return a snapshot of activity within this
   * window and a cursor the client can poll from again.
   */
  activityWindowMs: number
}

function env(name: string): string | undefined {
  const v = process.env[name]
  return v && v.length > 0 ? v : undefined
}

export function loadConfig(): McpConfig {
  const ablyApiKey = env("ABLY_API_KEY") ?? env("OPENREMOTE_ABLY_KEY")
  if (!ablyApiKey) {
    throw new Error(
      "roamux-mcp requires ABLY_API_KEY (the roamux Ably key). Set it in the environment.",
    )
  }
  const windowRaw = env("ROAMUX_MCP_ACTIVITY_WINDOW_MS")
  const activityWindowMs = windowRaw ? Number.parseInt(windowRaw, 10) : 2500
  if (!Number.isFinite(activityWindowMs) || activityWindowMs <= 0) {
    throw new Error(`ROAMUX_MCP_ACTIVITY_WINDOW_MS must be a positive integer, got "${windowRaw}"`)
  }
  return {
    ablyApiKey,
    userId: env("ROAMUX_MCP_USER_ID") ?? LOCAL_USER,
    activityWindowMs,
  }
}
