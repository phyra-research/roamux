#!/usr/bin/env bun
/**
 * Single source of truth for "is this change OK to commit / hand off".
 * Runs typecheck → lint → tests and fails loudly on the first broken gate.
 * Wired into `bun run check` and the pre-commit hook so humans and agents
 * are held to the same bar (see CLAUDE.md §8).
 */
import { spawnSync } from "node:child_process"

type Gate = { name: string; cmd: string[] }

const gates: Gate[] = [
  { name: "typecheck", cmd: ["bun", "run", "typecheck"] },
  { name: "lint", cmd: ["bunx", "biome", "check", "."] },
  { name: "tests", cmd: ["bun", "test"] },
]

let failed = false
for (const gate of gates) {
  process.stdout.write(`\n▶ ${gate.name}\n`)
  const [bin, ...args] = gate.cmd
  const result = spawnSync(bin as string, args, { stdio: "inherit" })
  if (result.status !== 0) {
    process.stdout.write(`\n✖ ${gate.name} failed\n`)
    failed = true
    break
  }
  process.stdout.write(`✓ ${gate.name} passed\n`)
}

if (failed) {
  process.stdout.write("\nDefinition of done NOT met. Fix the above before committing.\n")
  process.exit(1)
}
process.stdout.write("\n✓ All checks passed — good to go.\n")
