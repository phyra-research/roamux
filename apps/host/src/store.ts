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
    `)
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

  /** Rotate the pairing token (e.g. `openremote host --rotate-token`). */
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
