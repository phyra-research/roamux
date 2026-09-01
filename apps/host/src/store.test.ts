import { describe, expect, test } from "bun:test"
import { HostStore } from "./store.js"

describe("HostStore", () => {
  test("creates and persists identity across instances (in-memory is fresh each time)", () => {
    const store = new HostStore(":memory:")
    const id1 = store.loadOrCreateIdentity("mac-a")
    expect(id1.deviceId).toBeTruthy()
    expect(id1.pairingToken).toMatch(/^[0-9a-f]{12}$/)
    // Same instance returns the same identity.
    const id2 = store.loadOrCreateIdentity("mac-a")
    expect(id2.deviceId).toBe(id1.deviceId)
    expect(id2.pairingToken).toBe(id1.pairingToken)
    store.close()
  })

  test("name is refreshed but identity is stable", () => {
    const store = new HostStore(":memory:")
    const id1 = store.loadOrCreateIdentity("old-name")
    const id2 = store.loadOrCreateIdentity("new-name")
    expect(id2.name).toBe("new-name")
    expect(id2.deviceId).toBe(id1.deviceId)
    store.close()
  })

  test("rotatePairingToken changes the token", () => {
    const store = new HostStore(":memory:")
    const id = store.loadOrCreateIdentity("mac")
    const rotated = store.rotatePairingToken()
    expect(rotated).not.toBe(id.pairingToken)
    expect(store.loadOrCreateIdentity("mac").pairingToken).toBe(rotated)
    store.close()
  })

  test("nextSequence is monotonic per session and independent across sessions", () => {
    const store = new HostStore(":memory:")
    expect(store.nextSequence("s1")).toBe(1)
    expect(store.nextSequence("s1")).toBe(2)
    expect(store.nextSequence("s1")).toBe(3)
    expect(store.nextSequence("s2")).toBe(1)
    expect(store.nextSequence("s1")).toBe(4)
    store.close()
  })
})
