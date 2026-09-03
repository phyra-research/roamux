import { createHash, randomBytes } from "node:crypto"

/** A long opaque secret (device_code, host secret) — url-safe base64. */
export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url")
}

/** A short, human-typable code like "WXYZ-1234" (no ambiguous chars). */
export function userCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789" // no I,L,O,0,1
  const pick = () => alphabet[Math.floor(Math.random() * alphabet.length)]
  const group = () => Array.from({ length: 4 }, pick).join("")
  return `${group()}-${group()}`
}

/** Hash a secret for at-rest storage (host credentials are stored hashed). */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex")
}
