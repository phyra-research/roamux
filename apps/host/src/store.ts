import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { newId, newPairingToken } from "@openremote/protocol"

/**
 * Host-local persistence. Deliberately tiny: identity (so a machine keeps its
 * deviceId + pairing token across restarts) and per-session sequence counters
 * (so event sequence numbers survive a reconnect, laying the groundwork for
 * M3 resume). Session content itself is not persisted in V0.
 */
export type Identity = {
  deviceId: string
  pairingToken: string
  name: string
}

export class HostStore {
  private readonly db: Database

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.exec("PRAGMA journal_mode = WAL;")
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS identity (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        device_id TEXT NOT NULL,
        pairing_token TEXT NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sequences (
        session_id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS account (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        api_url TEXT NOT NULL,
        host_id TEXT NOT NULL,
        host_secret TEXT NOT NULL,
        user_id TEXT
      );
      CREATE TABLE IF NOT EXISTS approved_projects (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        abs_path TEXT NOT NULL
      );
    `)
  }

  /**
   * Approve a local directory as a project. Clients later reference `id`; the
   * daemon maps it to `absPath` (never sent over the wire). `id` is stable and
   * derived from the path so re-approving the same dir is idempotent.
   */
  approveProject(input: { id: string; label: string; absPath: string }): void {
    this.db.run(
      `INSERT INTO approved_projects (id, label, abs_path) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET label = excluded.label, abs_path = excluded.abs_path`,
      [input.id, input.label, input.absPath],
    )
  }

  /** List approved projects (id + label for the client; path stays host-local). */
  listApprovedProjects(): { id: string; label: string; absPath: string }[] {
    return this.db
      .query<{ id: string; label: string; abs_path: string }, []>(
        "SELECT id, label, abs_path FROM approved_projects ORDER BY label ASC",
      )
      .all()
      .map((r) => ({ id: r.id, label: r.label, absPath: r.abs_path }))
  }

  /** Resolve an approved projectId to its local absolute path, or null. */
  resolveProjectPath(projectId: string): string | null {
    const row = this.db
      .query<{ abs_path: string }, [string]>("SELECT abs_path FROM approved_projects WHERE id = ?")
      .get(projectId)
    return row?.abs_path ?? null
  }

  /** Persist the account link from `roamux login` (device-auth result). */
  saveAccount(link: {
    apiUrl: string
    hostId: string
    hostSecret: string
    userId?: string
  }): void {
    this.db.run(
      `INSERT INTO account (id, api_url, host_id, host_secret, user_id) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET api_url = excluded.api_url,
         host_id = excluded.host_id, host_secret = excluded.host_secret,
         user_id = excluded.user_id`,
      [link.apiUrl, link.hostId, link.hostSecret, link.userId ?? null],
    )
  }

  /** Load the account link, or null if this host hasn't run `roamux login`. */
  loadAccount(): {
    apiUrl: string
    hostId: string
    hostSecret: string
    userId: string | null
  } | null {
    const row = this.db
      .query<{ api_url: string; host_id: string; host_secret: string; user_id: string | null }, []>(
        "SELECT api_url, host_id, host_secret, user_id FROM account WHERE id = 1",
      )
      .get()
    return row
      ? {
          apiUrl: row.api_url,
          hostId: row.host_id,
          hostSecret: row.host_secret,
          userId: row.user_id,
        }
      : null
  }

  /** Load the machine identity, creating it on first run. `name` is refreshed. */
  loadOrCreateIdentity(name: string): Identity {
    const row = this.db
      .query<{ device_id: string; pairing_token: string; name: string }, []>(
        "SELECT device_id, pairing_token, name FROM identity WHERE id = 1",
      )
      .get()

    if (row) {
      if (row.name !== name) {
        this.db.run("UPDATE identity SET name = ? WHERE id = 1", [name])
      }
      return { deviceId: row.device_id, pairingToken: row.pairing_token, name }
    }

    const identity: Identity = {
      deviceId: newId(),
      pairingToken: newPairingToken(),
      name,
    }
    this.db.run("INSERT INTO identity (id, device_id, pairing_token, name) VALUES (1, ?, ?, ?)", [
      identity.deviceId,
      identity.pairingToken,
      identity.name,
    ])
    return identity
  }

  /** Rotate the pairing token (e.g. `roamux host --rotate-token`). */
  rotatePairingToken(): string {
    const token = newPairingToken()
    this.db.run("UPDATE identity SET pairing_token = ? WHERE id = 1", [token])
    return token
  }

  /** Atomically increment and return the next sequence number for a session. */
  nextSequence(sessionId: string): number {
    const row = this.db
      .query<{ seq: number }, [string]>(
        `INSERT INTO sequences (session_id, seq) VALUES (?, 1)
         ON CONFLICT(session_id) DO UPDATE SET seq = seq + 1
         RETURNING seq`,
      )
      .get(sessionId)
    return row?.seq ?? 1
  }

  close(): void {
    this.db.close()
  }
}
