import { hostname } from "node:os"
import { resolve } from "node:path"

export type AdapterKind = "mock" | "opencode"

export type HostConfig = {
  relayUrl: string
  hostName: string
  adapter: AdapterKind
  opencodeUrl: string | undefined
  defaultProjectPath: string
  dbPath: string
  /** Base web URL used to render the pairing link. */
  webUrl: string
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
  }
}
