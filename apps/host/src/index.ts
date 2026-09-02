#!/usr/bin/env bun
import type { HarnessAdapter } from "@openremote/agent-adapters"
import { MockAgentAdapter, OpenCodeAdapter } from "@openremote/agent-adapters"
import { AblyTransport, type HostInfo, pairingChannel } from "@openremote/protocol"
import { type HostConfig, loadConfig } from "./config.js"
import { type SpawnedOpenCode, spawnOpenCode } from "./opencode-process.js"
import { RelayConnection } from "./relay-connection.js"
import { HostStore } from "./store.js"

const log = (msg: string) => console.log(`[host] ${msg}`)

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

  const hostInfo = (): HostInfo => ({
    deviceId: identity.deviceId,
    name: identity.name,
    online: true,
    adapter: adapter.name,
    activeSessions: 0,
  })

  printBanner(config, hostInfo(), identity.pairingToken)

  // Transport selection: local relay WebSocket (default) or Ably (dumb pipe).
  // Over Ably there is no relay — host and clients meet on a shared control
  // channel scoped to this host, so the host publishes/subscribes there.
  const createTransport =
    config.transport === "ably"
      ? () =>
          new AblyTransport({
            // Phase 1 rendezvous: host + paired client meet on the token channel.
            channel: pairingChannel(identity.pairingToken),
            apiKey: config.ablyApiKey,
            clientId: `host:${identity.deviceId}`,
          })
      : undefined // undefined → RelayConnection defaults to WebSocketTransport

  const connection = new RelayConnection({
    relayUrl: config.relayUrl,
    adapter,
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

main().catch((err) => {
  console.error("[host] fatal:", err)
  process.exit(1)
})
