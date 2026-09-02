import { describe, expect, test } from "bun:test"
import { IdempotencyCache } from "./idempotency-cache.js"

describe("IdempotencyCache", () => {
  test("first sight is new, second is a duplicate", () => {
    const c = new IdempotencyCache()
    expect(c.markProcessed("m1")).toBe(true)
    expect(c.markProcessed("m1")).toBe(false)
    expect(c.has("m1")).toBe(true)
  })

  test("distinct ids are all new", () => {
    const c = new IdempotencyCache()
    expect(c.markProcessed("a")).toBe(true)
    expect(c.markProcessed("b")).toBe(true)
    expect(c.size).toBe(2)
  })

  test("evicts oldest beyond maxSize (bounded memory)", () => {
    const c = new IdempotencyCache(3)
    c.markProcessed("1")
    c.markProcessed("2")
    c.markProcessed("3")
    c.markProcessed("4") // evicts "1"
    expect(c.size).toBe(3)
    expect(c.has("1")).toBe(false)
    expect(c.has("4")).toBe(true)
    // "1" seen again counts as new since it was evicted
    expect(c.markProcessed("1")).toBe(true)
  })
})
