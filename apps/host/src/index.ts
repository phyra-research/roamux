#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { basename } from "node:path"
import type { HarnessAdapter } from "@openremote/agent-adapters"
import { MockAgentAdapter, OpenCodeAdapter } from "@openremote/agent-adapters"
import { AblyTransport, type HostInfo, controlChannel, pairingChannel } from "@openremote/protocol"
import { nodeRealtimeCtor } from "@openremote/protocol/ably-node"
import { type HostConfig, loadConfig } from "./config.js"
import { HostSessionManager } from "./host-session-manager.js"
import { defaultHostName, runLogin } from "./login.js"
import { type SpawnedOpenCode, spawnOpenCode } from "./opencode-process.js"
import { RelayConnection } from "./relay-connection.js"
import { HostStore } from "./store.js"

const log = (msg: string) => console.log(`[host] ${msg}`)

/** Stable projectId derived from an absolute path (so re-approve is idempotent). */
function projectIdFor(absPath: string): string {
  return `proj_${createHash("sha256").update(absPath).digest("hex").slice(0, 12)}`
}

/** `openremote login` — link this machine to an account via device-auth. */
async function loginCommand(): Promise<void> {
  const config = loadConfig()
  const store = new HostStore(config.dbPath)
  const apiUrl = process.env.OPENREMOTE_API_URL ?? config.webUrl
  try {
    await runLogin({ apiUrl, hostName: defaultHostName(), store })
  } finally {
    store.close()
  }
}

async function buildAdapter(
  config: HostConfig,
): Promise<{ adapter: HarnessAdapter; opencode?: SpawnedOpenCode }> {
  if (config.adapter === "mock") {
    return { adapter: new MockAgentAdapter() }
  }

  // opencode: use the given URL, or spawn a local server bound to localhost.
  let baseUrl = config.opencodeUrl
  let opencode: SpawnedOpenCode | undefined
  if (!baseUrl) {
    log("no OPENCODE_URL set — starting a local `opencode serve` on 127.0.0.1 …")
    opencode = await spawnOpenCode({ cwd: config.defaultProjectPath })
    baseUrl = opencode.url
    log(`opencode server ready at ${baseUrl}`)
  } else if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(baseUrl)) {
    // Enforce the localhost-only invariant on an externally-provided URL.
    throw new Error(
      `OPENCODE_URL must point at localhost (got "${baseUrl}"). OpenRemote never talks to a public OpenCode.`,
    )
  }

  const adapter = new OpenCodeAdapter({ baseUrl, directory: config.defaultProjectPath })
  return { adapter, opencode }
}

function printBanner(config: HostConfig, info: HostInfo, pairingToken: string): void {
  const pairUrl = `${config.webUrl}/pair?token=${pairingToken}`
  console.log("")
  console.log("  OpenRemote Host")
  console.log("")
  console.log(`  Device:    ${info.name}`)
  console.log(`  Adapter:   ${info.adapter}`)
  console.log(`  Transport: ${config.transport}`)
  console.log(
    config.transport === "ably"
      ? "  Ably:      connected via control channel"
      : `  Relay:     ${config.relayUrl}`,
  )
  console.log("")
  console.log("  Pair this device:")
  console.log("")
  console.log(`    ${pairUrl}`)
  console.log("")
  console.log(`  (pairing token: ${pairingToken})`)
  console.log("")
}

async function main(): Promise<void> {
  const config = loadConfig()
  const store = new HostStore(config.dbPath)
  const identity = store.loadOrCreateIdentity(config.hostName)

  const { adapter, opencode } = await buildAdapter(config)
  await adapter.start()

  // The manager owns session creation across harnesses. Register this adapter
  // and approve the default project so it's immediately usable from a client.
  const manager = new HostSessionManager(store)
  manager.register(adapter)
  const defaultId = projectIdFor(config.defaultProjectPath)
  store.approveProject({
    id: defaultId,
    label: basename(config.defaultProjectPath) || config.defaultProjectPath,
    absPath: config.defaultProjectPath,
  })

  const hostInfo = (): HostInfo => ({
    deviceId: identity.deviceId,
    name: identity.name,
    online: true,
    adapter: adapter.name,
    activeSessions: 0,
  })

  printBanner(config, hostInfo(), identity.pairingToken)

  // Transport selection: local relay WebSocket (default) or Ably (no relay —
  // host and clients meet on a shared channel). If this host is LINKED to an
  // account (openremote login), use the account-scoped control channel so a
  // signed-in browser reaches it by hostId — no pairing token needed (Beta §5.4).
  // Otherwise fall back to the pairing-token channel (pre-account / local dev).
  const account = store.loadAccount()
  const ablyChannel =
    account?.userId && account.hostId
      ? controlChannel(account.hostId, account.userId)
      : pairingChannel(identity.pairingToken)
  const createTransport =
    config.transport === "ably"
      ? () =>
          new AblyTransport({
            channel: ablyChannel,
            apiKey: config.ablyApiKey,
            clientId: `host:${identity.deviceId}`,
            RealtimeImpl: nodeRealtimeCtor(),
          })
      : undefined // undefined → RelayConnection defaults to WebSocketTransport

  const connection = new RelayConnection({
    relayUrl: config.relayUrl,
    manager,
    store,
    deviceId: identity.deviceId,
    pairingToken: identity.pairingToken,
    hostInfo,
    log,
    ...(createTransport ? { createTransport } : {}),
  })
  connection.start()

  const shutdown = async () => {
    log("shutting down …")
    connection.stop()
    await adapter.stop()
    opencode?.stop()
    store.close()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

// Subcommand dispatch: `login` runs device-auth; anything else runs the host.
const command = process.argv[2]
const entry = command === "login" ? loginCommand : main

entry().catch((err) => {
  console.error("[host] fatal:", err)
  process.exit(1)
})
