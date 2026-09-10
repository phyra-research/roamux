import { mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { IS_PACKAGED } from "../config.js"
import { installLaunchd, launchdStatus, uninstallLaunchd } from "./launchd.js"
import { installSystemd, systemdStatus, uninstallSystemd } from "./systemd.js"

/**
 * Install `openremote host` as a user-level background service so it survives
 * terminal-close, logout, and reboot. macOS uses a launchd agent, Linux uses a
 * `systemd --user` unit; Windows is not supported yet.
 *
 * SECURITY: only env vars the invoking shell already set are propagated, and
 * only the non-secret ones (INLINE_ENV_VARS) are written into the unit file.
 * ABLY_API_KEY is a secret (CLAUDE.md §3) — it goes into a mode-0600 sidecar
 * (`service.env`) that the unit references, never inline. Nothing is read from
 * the host's sqlite store.
 */

/** Non-secret env vars baked directly into the unit. Kept sorted. */
export const INLINE_ENV_VARS = [
  "AGENT_ADAPTER",
  "HOST_DB_PATH",
  "HOST_NAME",
  "OPENCODE_URL",
  "TRANSPORT",
] as const

/** Secret env vars — written to the 0600 sidecar, never into the unit file. */
export const SECRET_ENV_VARS = ["ABLY_API_KEY"] as const

export type ServiceSpec = {
  /** argv for the daemon, e.g. ["/usr/local/bin/openremote", "host"]. */
  execArgs: string[]
  /** Service working directory (the user's home). */
  home: string
  /** Directory that receives the stdout/stderr log files. */
  logDir: string
  /** Absolute path of the mode-0600 sidecar that may hold secret env vars. */
  secretEnvFile: string
  /** Non-secret environment, baked into the unit. */
  inlineEnv: Record<string, string>
  /** Secret environment, written to `secretEnvFile` only. */
  secretEnv: Record<string, string>
}

export type ServiceStatus = { installed: boolean; running: boolean; detail: string }

function pickEnv(
  names: readonly string[],
  env: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of names) {
    const value = env[name]
    if (value !== undefined && value !== "") out[name] = value
  }
  return out
}

/** Build the platform-neutral service spec from the current environment. */
export function resolveSpec(env: Record<string, string | undefined> = process.env): ServiceSpec {
  const home = homedir()
  const liveDir = join(home, ".openremote-live")
  // A packaged binary IS process.execPath, so `<binary> host` is enough. From
  // source, execPath is `bun`, so the script path has to ride along too.
  const execArgs = IS_PACKAGED
    ? [process.execPath, "host"]
    : [process.execPath, resolve(process.argv[1] ?? "src/index.ts"), "host"]
  return {
    execArgs,
    home,
    logDir: join(liveDir, "logs"),
    secretEnvFile: join(liveDir, "service.env"),
    inlineEnv: pickEnv(INLINE_ENV_VARS, env),
    secretEnv: pickEnv(SECRET_ENV_VARS, env),
  }
}

type Platform = "launchd" | "systemd"

function currentPlatform(): Platform {
  if (process.platform === "darwin") return "launchd"
  if (process.platform === "linux") return "systemd"
  throw new Error(
    `openremote service is not supported on ${process.platform} yet — run \`openremote host\` in a terminal instead.`,
  )
}

/** Write the secret sidecar at mode 0600, or skip it when there are no secrets. */
function writeSecretEnvFile(spec: ServiceSpec): void {
  const entries = Object.entries(spec.secretEnv)
  if (entries.length === 0) return
  mkdirSync(dirname(spec.secretEnvFile), { recursive: true })
  writeFileSync(spec.secretEnvFile, `${entries.map(([k, v]) => `${k}=${v}`).join("\n")}\n`, {
    mode: 0o600,
  })
}

export function installService(): void {
  const platform = currentPlatform()
  const spec = resolveSpec()
  mkdirSync(spec.logDir, { recursive: true })
  writeSecretEnvFile(spec)
  if (platform === "launchd") installLaunchd(spec)
  else installSystemd(spec)
}

export function uninstallService(): void {
  if (currentPlatform() === "launchd") uninstallLaunchd()
  else uninstallSystemd()
}

export function printServiceStatus(): void {
  const platform = currentPlatform()
  const status = platform === "launchd" ? launchdStatus() : systemdStatus()
  console.log("")
  console.log(`  OpenRemote service (${platform})`)
  console.log(`  installed: ${status.installed ? "yes" : "no"}`)
  console.log(`  running:   ${status.running ? "yes" : "no"}`)
  if (status.detail) console.log(`  ${status.detail}`)
  console.log("")
}
