import postgres, { type Sql } from "postgres"

/**
 * Lazily-created Postgres client for the control plane. Reads `DATABASE_URL`
 * (the Supabase connection string). Kept lazy so importing this package never
 * forces a connection — code that doesn't touch the DB (and tests) stays clean.
 *
 * Uses the pooler-friendly defaults appropriate for serverless (Vercel) where
 * each invocation is short-lived: a small pool, prepared statements off (the
 * Supabase transaction pooler doesn't support them).
 */
let sql: Sql | null = null

export function db(): Sql {
  if (sql) return sql
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  sql = postgres(url, {
    max: 5,
    prepare: false, // why: Supabase transaction pooler rejects prepared statements
    idle_timeout: 20,
  })
  return sql
}

/** For tests/scripts: inject a specific client (e.g. a throwaway test DB). */
export function setDb(client: Sql): void {
  sql = client
}

/** Close the pool (scripts/tests). */
export async function closeDb(): Promise<void> {
  if (sql) {
    await sql.end({ timeout: 5 })
    sql = null
  }
}
