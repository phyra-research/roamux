import { hostname } from "node:os"
import { resolve } from "node:path"

export type AdapterKind = "mock" | "opencode" | "claude-code" | "codex"
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

import { homedir } from "node:os"
import { join } from "node:path"
import { BAKED_ABLY_KEY, BAKED_API_URL } from "./baked-config.js"

function env(name: string): string | undefined {
  const v = process.env[name]
  return v === undefined || v === "" ? undefined : v
}

/** Whether the process is a distributed binary (has baked config). */
export const IS_PACKAGED = BAKED_API_URL !== undefined

export function loadConfig(): HostConfig {
  const adapter = (env("AGENT_ADAPTER") ?? (IS_PACKAGED ? "opencode" : "mock")) as AdapterKind
  const valid: AdapterKind[] = ["mock", "opencode", "claude-code", "codex"]
  if (!valid.includes(adapter)) {
    throw new Error(
      `AGENT_ADAPTER must be one of ${valid.map((v) => `"${v}"`).join(", ")}, got "${adapter}"`,
    )
  }
  // Packaged binaries default to Ably (they reach a hosted account); running from
  // source defaults to the local relay WS.
  const transport = (env("TRANSPORT") ?? (IS_PACKAGED ? "ably" : "ws")) as TransportKind
  if (transport !== "ws" && transport !== "ably") {
    throw new Error(`TRANSPORT must be "ws" or "ably", got "${transport}"`)
  }
  const ablyApiKey = env("ABLY_API_KEY") ?? BAKED_ABLY_KEY
  if (transport === "ably" && !ablyApiKey) {
    throw new Error("TRANSPORT=ably requires ABLY_API_KEY (or a packaged build)")
  }
  // Packaged binaries store state under ~/.openremote so they work from any cwd.
  const defaultDb = IS_PACKAGED
    ? join(homedir(), ".openremote", "host.sqlite")
    : ".openremote/host.sqlite"
  return {
    relayUrl: env("RELAY_URL") ?? "ws://127.0.0.1:8787",
    hostName: env("HOST_NAME") ?? hostname(),
    adapter,
    opencodeUrl: env("OPENCODE_URL"),
    // The project directory OpenCode operates on. Resolved to absolute so the
    // spawn cwd and the directory-scoped session listing always agree.
    defaultProjectPath: resolve(env("DEFAULT_PROJECT_PATH") ?? process.cwd()),
    dbPath: env("HOST_DB_PATH") ?? defaultDb,
    webUrl: env("WEB_URL") ?? BAKED_API_URL ?? "http://localhost:3000",
    transport,
    ablyApiKey,
  }
}
