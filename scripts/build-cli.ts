#!/usr/bin/env bun
/**
 * Build the distributable `openremote` CLI binaries with production config baked
 * in. Produces one self-contained executable per target (no Bun/repo needed on
 * the user's machine). Output → dist/cli/.
 *
 * Config is injected at compile time via --define, read by apps/host/src/
 * baked-config.ts. Provide it via env:
 *   OPENREMOTE_API_URL   e.g. https://remote.phyra.ai
 *   OPENREMOTE_ABLY_KEY  the shared beta Ably key
 *
 * Usage: OPENREMOTE_API_URL=... OPENREMOTE_ABLY_KEY=... bun run scripts/build-cli.ts
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"

const API_URL = process.env.OPENREMOTE_API_URL
const ABLY_KEY = process.env.OPENREMOTE_ABLY_KEY
if (!API_URL || !ABLY_KEY) {
  console.error("Set OPENREMOTE_API_URL and OPENREMOTE_ABLY_KEY to bake into the binary.")
  process.exit(1)
}

const ENTRY = join(import.meta.dir, "..", "apps", "host", "src", "index.ts")
// Output to dist/cli/ (gitignored). Binaries are published as GitHub Release
// assets, NOT committed to the repo (they're ~60–80MB each and OOM the commit).
// Upload dist/cli/* to a GitHub Release; install.sh pulls from releases/latest.
const OUT_DIR = join(import.meta.dir, "..", "dist", "cli")
mkdirSync(OUT_DIR, { recursive: true })

// (target triple → output filename). Bun cross-compiles to each. Beta ships
// macOS arm64 + Linux x64; add more targets here as needed.
const TARGETS: { target: string; out: string }[] = [
  { target: "bun-darwin-arm64", out: "openremote-darwin-arm64" },
  { target: "bun-linux-x64", out: "openremote-linux-x64" },
]

const define = [
  "--define",
  `__OPENREMOTE_API_URL__=${JSON.stringify(API_URL)}`,
  "--define",
  `__OPENREMOTE_ABLY_KEY__=${JSON.stringify(ABLY_KEY)}`,
]

for (const { target, out } of TARGETS) {
  const outfile = join(OUT_DIR, out)
  process.stdout.write(`▶ building ${out} (${target}) … `)
  const proc = Bun.spawnSync([
    "bun",
    "build",
    ENTRY,
    "--compile",
    "--target",
    target,
    ...define,
    "--outfile",
    outfile,
  ])
  if (proc.exitCode !== 0) {
    console.log("FAILED")
    console.error(new TextDecoder().decode(proc.stderr))
    process.exit(1)
  }
  console.log("ok")
}

console.log(`\n✓ Binaries in ${OUT_DIR}`)
