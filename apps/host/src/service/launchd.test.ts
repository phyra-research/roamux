import { describe, expect, test } from "bun:test"
import type { ServiceSpec } from "./index.js"
import { interpretLaunchdStatus, renderPlist } from "./launchd.js"

const SPEC: ServiceSpec = {
  execArgs: ["/opt/roamux/roamux", "host"],
  home: "/home/tester",
  logDir: "/home/tester/.roamux-live/logs",
  secretEnvFile: "/home/tester/.roamux-live/service.env",
  inlineEnv: { HOST_NAME: "tester-box", TRANSPORT: "ably" },
  secretEnv: { ABLY_API_KEY: "super-secret-key" },
}

describe("renderPlist", () => {
  test("matches the expected launchd plist", () => {
    const expected = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      "<dict>",
      "\t<key>Label</key>",
      "\t<string>ai.phyra.roamux</string>",
      "\t<key>ProgramArguments</key>",
      "\t<array>",
      "\t\t<string>/bin/sh</string>",
      "\t\t<string>-c</string>",
      "\t\t<string>[ -r '/home/tester/.roamux-live/service.env' ] &amp;&amp; . '/home/tester/.roamux-live/service.env'; exec '/opt/roamux/roamux' 'host'</string>",
      "\t</array>",
      "\t<key>RunAtLoad</key>",
      "\t<true/>",
      "\t<key>KeepAlive</key>",
      "\t<true/>",
      "\t<key>WorkingDirectory</key>",
      "\t<string>/home/tester</string>",
      "\t<key>StandardOutPath</key>",
      "\t<string>/home/tester/.roamux-live/logs/host.out.log</string>",
      "\t<key>StandardErrorPath</key>",
      "\t<string>/home/tester/.roamux-live/logs/host.err.log</string>",
      "\t<key>EnvironmentVariables</key>",
      "\t<dict>",
      "\t\t<key>HOST_NAME</key>",
      "\t\t<string>tester-box</string>",
      "\t\t<key>TRANSPORT</key>",
      "\t\t<string>ably</string>",
      "\t</dict>",
      "</dict>",
      "</plist>",
      "",
    ].join("\n")
    expect(renderPlist(SPEC)).toBe(expected)
  })

  test("omits the EnvironmentVariables block when there is no inline env", () => {
    const out = renderPlist({ ...SPEC, inlineEnv: {} })
    expect(out).not.toContain("EnvironmentVariables")
  })

  test("never embeds a secret — only references the sidecar", () => {
    const out = renderPlist(SPEC)
    expect(out).not.toContain("ABLY_API_KEY")
    expect(out).not.toContain("super-secret-key")
    expect(out).toContain("/home/tester/.roamux-live/service.env")
  })
})

describe("interpretLaunchdStatus", () => {
  test("installed + running when the plist exists and launchd reports running", () => {
    expect(
      interpretLaunchdStatus({
        plistExists: true,
        printExitCode: 0,
        printOutput: "  state = running\n  pid = 42",
      }),
    ).toEqual({ installed: true, running: true, detail: "launchd state: running" })
  })

  test("installed but not running when launchd reports a non-running state", () => {
    expect(
      interpretLaunchdStatus({
        plistExists: true,
        printExitCode: 0,
        printOutput: "  state = waiting",
      }),
    ).toEqual({ installed: true, running: false, detail: "launchd state: waiting" })
  })

  test("not installed once the plist is gone, even while `launchctl print` still exits 0", () => {
    // Regression: after `service uninstall`, launchctl print lingers at exit 0
    // for a moment — status must key off the plist file, not that exit code.
    expect(
      interpretLaunchdStatus({
        plistExists: false,
        printExitCode: 0,
        printOutput: "  state = running",
      }),
    ).toEqual({ installed: false, running: false, detail: "launchd state: running" })
  })

  test("not installed and not running when the job is fully gone", () => {
    expect(
      interpretLaunchdStatus({ plistExists: false, printExitCode: 1, printOutput: "" }),
    ).toEqual({ installed: false, running: false, detail: "" })
  })
})
