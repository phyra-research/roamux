/**
 * Build-time baked configuration for the distributed `openremote` binary.
 *
 * These are replaced at compile time via `bun build --define` (see
 * scripts/build-cli.ts), so the shipped binary knows the production API URL and
 * Ably key with zero user setup. When running from source (no --define), they
 * fall back to the placeholders below and the env vars take over.
 *
 * The Ably key baked here is the shared beta key — acceptable for beta (it's the
 * same key the server uses to mint browser tokens). A future release can switch
 * the host to fetch scoped credentials from the API instead.
 */
declare const __OPENREMOTE_API_URL__: string | undefined
declare const __OPENREMOTE_ABLY_KEY__: string | undefined

function baked(value: string | undefined): string | undefined {
  // A non-empty, non-placeholder value means it was injected at build time.
  return value && !value.startsWith("__") ? value : undefined
}

export const BAKED_API_URL = baked(
  typeof __OPENREMOTE_API_URL__ !== "undefined" ? __OPENREMOTE_API_URL__ : undefined,
)

export const BAKED_ABLY_KEY = baked(
  typeof __OPENREMOTE_ABLY_KEY__ !== "undefined" ? __OPENREMOTE_ABLY_KEY__ : undefined,
)
