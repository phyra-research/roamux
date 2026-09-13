#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { basename } from "node:path"
import type { HarnessAdapter } from "@openremote/agent-adapters"
import {
  ClaudeCodeAdapter,
  CodexAdapter,
  MockAgentAdapter,
  OpenCodeAdapter,
} from "@openremote/agent-adapters"
import { AblyTransport, type HostInfo, controlChannel, pairingChannel } from "@openremote/protocol"
import { nodeRealtimeCtor } from "@openremote/protocol/ably-node"
import { type HostConfig, loadConfig } from "./config.js"
import { HostSessionManager } from "./host-session-manager.js"
import { defaultHostName, runLogin } from "./login.js"
import { type SpawnedOpenCode, spawnOpenCode } from "./opencode-process.js"
import { preflightClaudeCode, preflightCodex, preflightOpenCode } from "./preflight.js"
import { RelayConnection } from "./relay-connection.js"
import { installService, printServiceStatus, uninstallService } from "./service/index.js"
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

function serviceUsage(): void {
  console.log(`
  Usage:
    openremote service install     Install + start the host as a background service
    openremote service uninstall   Stop + remove the background service
    openremote service status      Show whether the service is installed and running

  macOS uses a launchd agent, Linux a \`systemd --user\` unit. The service inherits
  HOST_NAME / TRANSPORT / AGENT_ADAPTER / HOST_DB_PATH / OPENCODE_URL from the shell
  you run \`install\` in. See docs/service.md.
`)
}

/** `openremote service <install|uninstall|status>` — manage the background service. */
function serviceCommand(action: string | undefined): void {
  try {
    switch (action) {
      case "install":
        installService()
        break
      case "uninstall":
        uninstallService()
        break
      case "status":
        printServiceStatus()
        break
      default:
        serviceUsage()
        if (action !== undefined) process.exitCode = 1
    }
  } catch (err) {
    console.error(`\n  ✗ ${(err as Error).message}\n`)
    process.exit(1)
  }
}

async function buildAdapter(
  config: HostConfig,
): Promise<{ adapter: HarnessAdapter; opencode?: SpawnedOpenCode }> {
  if (config.adapter === "mock") {
    return { adapter: new MockAgentAdapter() }
  }

  if (config.adapter === "codex") {
    // No server to spawn — codex exec is one subprocess per prompt.
    return { adapter: new CodexAdapter({ cwd: config.defaultProjectPath }) }
  }

  if (config.adapter === "claude-code") {
    // No server to spawn — Claude Code print mode is one subprocess per prompt.
    return { adapter: new ClaudeCodeAdapter({ cwd: config.defaultProjectPath }) }
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

  // Preflight: make sure the selected agent CLI is installed and usable —
  // otherwise it silently returns nothing (or fails every run). Print actionable
  // guidance and exit cleanly instead of crashing later.
  const preflight =
    config.adapter === "opencode" && !config.opencodeUrl
      ? await preflightOpenCode()
      : config.adapter === "codex"
        ? await preflightCodex()
        : config.adapter === "claude-code"
          ? await preflightClaudeCode()
          : null
  if (preflight && !preflight.ok) {
    console.log("")
    for (const line of preflight.messages) console.log(`  ${line}`)
    console.log("")
    process.exit(1)
  }

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

  // If linked to an account, report "online" to the API so the machine list
  // shows a green dot, and heartbeat periodically. Best-effort — failures are
  // logged, never fatal.
  let heartbeat: ReturnType<typeof setInterval> | undefined
  if (account?.hostId && account.hostSecret) {
    const beat = async (status: "online" | "offline") => {
      try {
        await fetch(`${account.apiUrl.replace(/\/$/, "")}/api/host/heartbeat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hostId: account.hostId, hostSecret: account.hostSecret, status }),
          // Time-boxed so a slow/unreachable API never blocks startup OR keeps
          // the loop wedged. (Previously the startup `await beat("online")` had
          // no timeout — a hanging API blocked main() before the SIGINT handler
          // was even registered, so Ctrl+C did nothing.)
          signal: AbortSignal.timeout(5000),
        })
      } catch (err) {
        log(`heartbeat failed: ${(err as Error).message}`)
      }
    }
    // Fire-and-forget the first beat — never block startup (or signal handler
    // registration) on the network.
    void beat("online")
    heartbeat = setInterval(() => void beat("online"), 30_000)
  }

  let shuttingDown = false
  const shutdown = async () => {
    // Second Ctrl+C while already shutting down → exit NOW. Guards against a slow
    // cleanup step and matches the standard CLI "press again to force" behavior.
    if (shuttingDown) {
      process.exit(130)
    }
    shuttingDown = true
    log("shutting down …")
    if (heartbeat) clearInterval(heartbeat)

    if (account?.hostId && account.hostSecret) {
      // Best-effort "offline" so the UI updates promptly — but TIME-BOXED. The
      // old code awaited this fetch with no timeout, so a slow/unreachable API
      // made Ctrl+C hang (people then reached for Ctrl+Z, which only suspends).
      // Race the fetch against a timeout: whichever wins, we move on. (An
      // AbortSignal alone isn't reliable against a server that accepts the
      // connection but never responds, so we don't depend on it.)
      const controller = new AbortController()
      const beat = fetch(`${account.apiUrl.replace(/\/$/, "")}/api/host/heartbeat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hostId: account.hostId,
          hostSecret: account.hostSecret,
          status: "offline",
        }),
        signal: controller.signal,
      }).catch(() => {})
      await Promise.race([beat, new Promise((r) => setTimeout(r, 1200))])
      controller.abort()
    }

    connection.stop()
    await adapter.stop()
    opencode?.stop()
    store.close()
    process.exit(0)
  }

  // Hard cap: no matter what cleanup does, exit within 2s of the signal so Ctrl+C
  // is always prompt. NOT unref'd — we want this to fire and force the exit.
  const shutdownWithCap = () => {
    setTimeout(() => process.exit(0), 2000)
    void shutdown()
  }
  process.on("SIGINT", shutdownWithCap)
  process.on("SIGTERM", shutdownWithCap)
}

const VERSION = "0.1.0"

function printHelp(): void {
  console.log(`
  OpenRemote — run coding agents on your machine, control them from anywhere.

  Usage:
    openremote login              Link this machine to your OpenRemote account
    openremote host               Start the host daemon (run your agents)
    openremote service <cmd>      Run the host as a background service (install/uninstall/status)
    openremote help               Show this help
    openremote version            Show the version

  Common options (via env):
    DEFAULT_PROJECT_PATH=<dir>    Project the agent works on (default: current dir)
    AGENT_ADAPTER=opencode|mock   Which agent runtime (default: opencode)
    HOST_NAME=<name>              Display name for this machine

  Quick start:
    1) openremote login           # approve in your browser
    2) cd ~/your/project
    3) openremote host            # now control it from the web app
`)
}

// Subcommand dispatch.
const command = process.argv[2] ?? "host"

async function dispatch(): Promise<void> {
  switch (command) {
    case "login":
      return loginCommand()
    case "help":
    case "--help":
    case "-h":
      return void printHelp()
    case "version":
    case "--version":
    case "-v":
      return void console.log(`openremote ${VERSION}`)
    case "host":
      return main()
    case "service":
      return void serviceCommand(process.argv[3])
    default:
      console.error(`unknown command: ${command}\n`)
      printHelp()
      process.exit(1)
  }
}

dispatch().catch((err) => {
  console.error("[host] fatal:", err)
  process.exit(1)
})
