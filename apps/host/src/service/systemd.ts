import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { ServiceSpec, ServiceStatus } from "./index.js"

/** systemd --user unit name. */
export const SYSTEMD_UNIT = "roamux.service"

function unitPath(): string {
  return join(homedir(), ".config", "systemd", "user", SYSTEMD_UNIT)
}

// systemd's own quoting; fine for ordinary paths (no spaces / shell metachars).
function unitArg(s: string): string {
  return /^[A-Za-z0-9_/.:=-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, "\\$1")}"`
}

/** Render the `systemd --user` unit for `spec`. Pure — no filesystem access. */
export function renderUnit(spec: ServiceSpec): string {
  const lines: string[] = [
    "[Unit]",
    "Description=roamux host daemon",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${spec.execArgs.map(unitArg).join(" ")}`,
    "Restart=on-failure",
    `WorkingDirectory=${spec.home}`,
  ]
  for (const k of Object.keys(spec.inlineEnv).sort()) {
    lines.push(`Environment=${k}=${spec.inlineEnv[k] ?? ""}`)
  }
  // Leading `-`: the secret sidecar is optional (only written when secrets exist).
  lines.push(
    `EnvironmentFile=-${spec.secretEnvFile}`,
    `StandardOutput=append:${join(spec.logDir, "host.out.log")}`,
    `StandardError=append:${join(spec.logDir, "host.err.log")}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  )
  return lines.join("\n")
}

function run(cmd: string, args: string[], opts: { check?: boolean; quiet?: boolean } = {}): number {
  const res = spawnSync(cmd, args, { stdio: opts.quiet ? "ignore" : "inherit" })
  const code = res.status ?? 1
  if (opts.check && code !== 0) throw new Error(`\`${cmd} ${args.join(" ")}\` exited ${code}`)
  return code
}

export function installSystemd(spec: ServiceSpec): void {
  const path = unitPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, renderUnit(spec), { mode: 0o644 })

  run("systemctl", ["--user", "daemon-reload"], { check: true })
  run("systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT], { check: true })

  console.log("")
  console.log(`  ✓ Installed systemd --user service ${SYSTEMD_UNIT}`)
  console.log(`    unit: ${path}`)
  console.log(`    logs: ${join(spec.logDir, "host.out.log")}`)
}

export function uninstallSystemd(): void {
  const path = unitPath()
  run("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT], { quiet: true }) // ignore: not enabled
  if (existsSync(path)) rmSync(path)
  run("systemctl", ["--user", "daemon-reload"], { quiet: true })
  console.log(`  ✓ Removed systemd --user service ${SYSTEMD_UNIT}`)
}

export function systemdStatus(): ServiceStatus {
  const installed = existsSync(unitPath())
  const res = spawnSync("systemctl", ["--user", "is-active", SYSTEMD_UNIT], { encoding: "utf8" })
  const state = `${res.stdout ?? ""}`.trim()
  return {
    installed,
    running: state === "active",
    detail: state ? `systemctl is-active: ${state}` : "",
  }
}
