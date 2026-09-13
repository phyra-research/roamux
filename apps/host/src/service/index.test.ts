import { describe, expect, test } from "bun:test"
import { resolveSpec } from "./index.js"

describe("resolveSpec", () => {
  test("keeps only whitelisted, non-empty env vars", () => {
    const spec = resolveSpec({
      HOST_NAME: "testbox",
      TRANSPORT: "ably",
      AGENT_ADAPTER: "", // empty → dropped
      OPENCODE_URL: undefined, // unset → dropped
      SOME_OTHER_VAR: "nope", // not whitelisted → dropped
    })
    expect(spec.inlineEnv).toEqual({ HOST_NAME: "testbox", TRANSPORT: "ably" })
  })

  test("routes ABLY_API_KEY to secretEnv, never inlineEnv", () => {
    const spec = resolveSpec({ ABLY_API_KEY: "super-secret-key", HOST_NAME: "x" })
    expect(spec.secretEnv).toEqual({ ABLY_API_KEY: "super-secret-key" })
    expect(spec.inlineEnv).not.toHaveProperty("ABLY_API_KEY")
  })

  test("secret sidecar path sits under ~/.roamux-live", () => {
    const spec = resolveSpec({})
    expect(spec.secretEnvFile.endsWith("/.roamux-live/service.env")).toBe(true)
    expect(spec.logDir.endsWith("/.roamux-live/logs")).toBe(true)
  })
})
