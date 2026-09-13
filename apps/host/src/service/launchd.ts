import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { ServiceSpec, ServiceStatus } from "./index.js"

/** launchd job label — also the plist basename. */
export const LAUNCHD_LABEL = "ai.phyra.roamux"

function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`)
}

// why: process.getuid is undefined only on Windows; this file is darwin-only.
function uid(): number {
  return process.getuid?.() ?? 0
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Render the launchd plist for `spec`. Pure — no filesystem access. */
export function renderPlist(spec: ServiceSpec): string {
  const argv = spec.execArgs.map((a) => a.replace(/'/g, "'\\''")).join("' '")
  // Source the 0600 secret sidecar if present, then exec the daemon — one
  // deterministic ProgramArguments whether or not secrets exist.
  const shellCmd = `[ -r '${spec.secretEnvFile}' ] && . '${spec.secretEnvFile}'; exec '${argv}'`

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "\t<key>Label</key>",
    `\t<string>${LAUNCHD_LABEL}</string>`,
    "\t<key>ProgramArguments</key>",
    "\t<array>",
    "\t\t<string>/bin/sh</string>",
    "\t\t<string>-c</string>",
    `\t\t<string>${xmlEscape(shellCmd)}</string>`,
    "\t</array>",
    "\t<key>RunAtLoad</key>",
    "\t<true/>",
    "\t<key>KeepAlive</key>",
    "\t<true/>",
    "\t<key>WorkingDirectory</key>",
    `\t<string>${xmlEscape(spec.home)}</string>`,
    "\t<key>StandardOutPath</key>",
    `\t<string>${xmlEscape(join(spec.logDir, "host.out.log"))}</string>`,
    "\t<key>StandardErrorPath</key>",
    `\t<string>${xmlEscape(join(spec.logDir, "host.err.log"))}</string>`,
  ]

  const envKeys = Object.keys(spec.inlineEnv).sort()
  if (envKeys.length > 0) {
    lines.push("\t<key>EnvironmentVariables</key>", "\t<dict>")
    for (const k of envKeys) {
      lines.push(
        `\t\t<key>${xmlEscape(k)}</key>`,
        `\t\t<string>${xmlEscape(spec.inlineEnv[k] ?? "")}</string>`,
      )
    }
    lines.push("\t</dict>")
  }

  lines.push("</dict>", "</plist>", "")
  return lines.join("\n")
}

function run(cmd: string, args: string[], opts: { check?: boolean; quiet?: boolean } = {}): number {
  const res = spawnSync(cmd, args, { stdio: opts.quiet ? "ignore" : "inherit" })
  const code = res.status ?? 1
  if (opts.check && code !== 0) throw new Error(`\`${cmd} ${args.join(" ")}\` exited ${code}`)
  return code
}

export function installLaunchd(spec: ServiceSpec): void {
  const path = plistPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, renderPlist(spec), { mode: 0o644 })

  const target = `gui/${uid()}`
  run("launchctl", ["bootout", `${target}/${LAUNCHD_LABEL}`], { quiet: true }) // ignore: not loaded
  run("launchctl", ["bootstrap", target, path], { check: true })
  run("launchctl", ["kickstart", "-k", `${target}/${LAUNCHD_LABEL}`], { check: true })

  console.log("")
  console.log(`  ✓ Installed launchd service ${LAUNCHD_LABEL}`)
  console.log(`    plist: ${path}`)
  console.log(`    logs:  ${join(spec.logDir, "host.out.log")}`)
}

export function uninstallLaunchd(): void {
  const path = plistPath()
  run("launchctl", ["bootout", `gui/${uid()}/${LAUNCHD_LABEL}`], { quiet: true }) // ignore: not loaded
  if (existsSync(path)) rmSync(path)
  console.log(`  ✓ Removed launchd service ${LAUNCHD_LABEL}`)
}

/** Pure: derive service status from the raw launchd probes. */
export function interpretLaunchdStatus(probe: {
  plistExists: boolean
  printExitCode: number
  printOutput: string
}): ServiceStatus {
  const loaded = probe.printExitCode === 0
  const state = /state = (\S+)/.exec(probe.printOutput)?.[1]
  return {
    // Installed iff the plist is on disk. `launchctl print` keeps exiting 0 for a
    // short window after `bootout`, so it must NOT get a vote on "installed" —
    // that's what made `status` report installed:yes right after uninstall.
    installed: probe.plistExists,
    running: probe.plistExists && loaded && state === "running",
    detail: loaded && state ? `launchd state: ${state}` : "",
  }
}

export function launchdStatus(): ServiceStatus {
  const res = spawnSync("launchctl", ["print", `gui/${uid()}/${LAUNCHD_LABEL}`], {
    encoding: "utf8",
  })
  return interpretLaunchdStatus({
    plistExists: existsSync(plistPath()),
    printExitCode: res.status ?? 1,
    printOutput: `${res.stdout ?? ""}`,
  })
}
