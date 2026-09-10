import { describe, expect, test } from "bun:test"
import type { ServiceSpec } from "./index.js"
import { renderUnit } from "./systemd.js"

const SPEC: ServiceSpec = {
  execArgs: ["/opt/openremote/openremote", "host"],
  home: "/home/tester",
  logDir: "/home/tester/.openremote-live/logs",
  secretEnvFile: "/home/tester/.openremote-live/service.env",
  inlineEnv: { HOST_NAME: "tester-box", TRANSPORT: "ably" },
  secretEnv: { ABLY_API_KEY: "super-secret-key" },
}

describe("renderUnit", () => {
  test("matches the expected systemd --user unit", () => {
    const expected = [
      "[Unit]",
      "Description=OpenRemote host daemon",
      "After=network-online.target",
      "Wants=network-online.target",
      "",
      "[Service]",
      "Type=simple",
      "ExecStart=/opt/openremote/openremote host",
      "Restart=on-failure",
      "WorkingDirectory=/home/tester",
      "Environment=HOST_NAME=tester-box",
      "Environment=TRANSPORT=ably",
      "EnvironmentFile=-/home/tester/.openremote-live/service.env",
      "StandardOutput=append:/home/tester/.openremote-live/logs/host.out.log",
      "StandardError=append:/home/tester/.openremote-live/logs/host.err.log",
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ].join("\n")
    expect(renderUnit(SPEC)).toBe(expected)
  })

  test("never embeds a secret — only references the optional sidecar", () => {
    const out = renderUnit(SPEC)
    expect(out).not.toContain("ABLY_API_KEY")
    expect(out).not.toContain("super-secret-key")
    expect(out).toContain("EnvironmentFile=-/home/tester/.openremote-live/service.env")
  })
})
