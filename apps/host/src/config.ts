import { hostname } from "node:os"
import { resolve } from "node:path"

export type AdapterKind = "mock" | "opencode"
export type TransportKind = "ws" | "ably"

export type HostConfig = {
  relayUrl: string
  hostName: string
  adapter: AdapterKind
  opencodeUrl: string | undefined
  defaultProjectPath: string
  dbPath: string
  /** Base web URL used to render the pairing link. */
  webUrl: string
  /** Which transport the host uses to reach clients: local relay WS, or Ably. */
  transport: TransportKind
  /** Ably API key (dev/self-host). Required when transport === "ably". */
  ablyApiKey: string | undefined
}

function env(name: string): string | undefined {
  const v = process.env[name]
  return v === undefined || v === "" ? undefined : v
}

export function loadConfig(): HostConfig {
  const adapter = (env("AGENT_ADAPTER") ?? "mock") as AdapterKind
  if (adapter !== "mock" && adapter !== "opencode") {
    throw new Error(`AGENT_ADAPTER must be "mock" or "opencode", got "${adapter}"`)
  }
  const transport = (env("TRANSPORT") ?? "ws") as TransportKind
  if (transport !== "ws" && transport !== "ably") {
    throw new Error(`TRANSPORT must be "ws" or "ably", got "${transport}"`)
  }
  const ablyApiKey = env("ABLY_API_KEY")
  if (transport === "ably" && !ablyApiKey) {
    throw new Error("TRANSPORT=ably requires ABLY_API_KEY")
  }
  return {
    relayUrl: env("RELAY_URL") ?? "ws://127.0.0.1:8787",
    hostName: env("HOST_NAME") ?? hostname(),
    adapter,
    opencodeUrl: env("OPENCODE_URL"),
    // The project directory OpenCode operates on. Resolved to absolute so the
    // spawn cwd and the directory-scoped session listing always agree.
    defaultProjectPath: resolve(env("DEFAULT_PROJECT_PATH") ?? process.cwd()),
    dbPath: env("HOST_DB_PATH") ?? ".openremote/host.sqlite",
    webUrl: env("WEB_URL") ?? "http://localhost:3000",
    transport,
    ablyApiKey,
  }
}
