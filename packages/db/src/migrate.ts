#!/usr/bin/env bun
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { closeDb, db } from "./client.js"

/**
 * Minimal forward-only migration runner. Applies every `migrations/NNNN_*.sql`
 * not yet recorded in `_migrations`, in filename order, each in a transaction.
 * Run with `bun run --cwd packages/db migrate` (needs DATABASE_URL).
 */
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations")

export async function migrate(): Promise<string[]> {
  const sql = db()
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `
  const appliedRows = await sql<{ name: string }[]>`SELECT name FROM _migrations`
  const applied = new Set(appliedRows.map((r) => r.name))

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()

  const ran: string[] = []
  for (const file of files) {
    if (applied.has(file)) continue
    const contents = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
    await sql.begin(async (tx) => {
      await tx.unsafe(contents)
      await tx`INSERT INTO _migrations (name) VALUES (${file})`
    })
    ran.push(file)
  }
  return ran
}

// Run directly (not when imported).
if (import.meta.main) {
  try {
    const ran = await migrate()
    if (ran.length === 0) console.log("migrate: nothing to apply (up to date)")
    else console.log(`migrate: applied ${ran.length} migration(s):\n  ${ran.join("\n  ")}`)
  } catch (err) {
    console.error("migrate: failed —", (err as Error).message)
    process.exitCode = 1
  } finally {
    await closeDb()
  }
}
