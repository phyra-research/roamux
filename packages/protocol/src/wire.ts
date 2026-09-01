import type { z } from "zod"
import { type Envelope, PROTOCOL_VERSION } from "./envelope.js"

/**
 * Return a random UUIDv4 using whatever the environment provides.
 *
 * `crypto.randomUUID()` is only exposed on SECURE contexts (https or
 * http://localhost) — it is NOT available when the web app is served over a
 * plain LAN IP like http://10.0.0.93, which is exactly the phone-access case.
 * So we fall back to `crypto.getRandomValues` (available on every context) and
 * assemble a v4 UUID by hand. Stays isomorphic (browser, Bun, Node) and never
 * pulls `node:crypto` into the browser bundle.
 */
function randomUUIDv4(): string {
  const g = globalThis.crypto
  if (g && typeof g.randomUUID === "function") {
    return g.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (g && typeof g.getRandomValues === "function") {
    g.getRandomValues(bytes)
  } else {
    // Last-resort fallback. Non-cryptographic; only hit on ancient runtimes.
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  // Per RFC 4122 §4.4: set version (4) and variant bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`
}

/** Generate a random id (device ids, message ids, pairing tokens). */
export function newId(): string {
  return randomUUIDv4()
}

/** A short, human-typable pairing token. Not a long-term secret (see M3). */
export function newPairingToken(): string {
  return randomUUIDv4().replace(/-/g, "").slice(0, 12)
}

export type EnvelopeParts = {
  deviceId: string
  sessionId?: string
  sequence?: number
  timestamp?: number
  messageId?: string
}

/** Wrap a message in a well-formed envelope with sensible defaults. */
export function createEnvelope<T>(message: T, parts: EnvelopeParts): Envelope<T> {
  const env: Envelope<T> = {
    protocolVersion: PROTOCOL_VERSION,
    messageId: parts.messageId ?? newId(),
    deviceId: parts.deviceId,
    timestamp: parts.timestamp ?? Date.now(),
    message,
  }
  if (parts.sessionId !== undefined) env.sessionId = parts.sessionId
  if (parts.sequence !== undefined) env.sequence = parts.sequence
  return env
}

export function serialize<T>(envelope: Envelope<T>): string {
  return JSON.stringify(envelope)
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Parse + validate raw socket data against a schema. Never throws — every
 * trust boundary uses this so a malformed frame degrades to a handled error
 * instead of crashing a long-running daemon.
 */
export function parseWith<S extends z.ZodTypeAny>(
  schema: S,
  raw: string | ArrayBuffer | Uint8Array | Buffer,
): ParseResult<z.infer<S>> {
  let text: string
  if (typeof raw === "string") {
    text = raw
  } else if (raw instanceof ArrayBuffer) {
    text = new TextDecoder().decode(raw)
  } else {
    text = new TextDecoder().decode(raw as Uint8Array)
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${(err as Error).message}` }
  }

  const result = schema.safeParse(json)
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => i.message).join("; ") }
  }
  return { ok: true, value: result.data }
}
