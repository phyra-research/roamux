import {
  type ClientToRelayEnvelope,
  ClientToRelayEnvelopeSchema,
  type HostInfo,
  type HostToRelayEnvelope,
  HostToRelayEnvelopeSchema,
  type RelayToClient,
  createEnvelope,
  parseWith,
  serialize,
} from "@openremote/protocol"

/** Anything the relay can push bytes to (a real WS, or a fake in tests). */
export interface Connection {
  readonly id: string
  send(data: string): void
  close(): void
}

type HostConn = {
  conn: Connection
  token: string
  info: HostInfo
}

type ClientConn = {
  conn: Connection
  token: string | null // set after a successful client.hello
}

/**
 * RelayCore — the entire routing brain, with zero transport dependencies.
 *
 * Rules (CLAUDE.md §3):
 *  - A host proves ownership of a pairing token via `host.hello`.
 *  - A client associates with a host by presenting the same token via
 *    `client.hello`. Until then it is unauthenticated and gets nothing routed.
 *  - Commands only flow client → its associated host. Events/snapshots flow
 *    host → all clients holding that host's token.
 *  - The relay never originates commands and never inspects payloads beyond
 *    what routing requires.
 */
export class RelayCore {
  /** token → host */
  private readonly hostsByToken = new Map<string, HostConn>()
  /** connection id → host record (reverse lookup on disconnect) */
  private readonly hostByConn = new Map<string, HostConn>()
  /** connection id → client record */
  private readonly clients = new Map<string, ClientConn>()

  private readonly log: (msg: string) => void

  constructor(opts: { log?: (msg: string) => void } = {}) {
    this.log = opts.log ?? (() => {})
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  addClient(conn: Connection): void {
    this.clients.set(conn.id, { conn, token: null })
  }

  removeConnection(connId: string): void {
    const host = this.hostByConn.get(connId)
    if (host) {
      this.hostByConn.delete(connId)
      if (this.hostsByToken.get(host.token)?.conn.id === connId) {
        this.hostsByToken.delete(host.token)
      }
      host.info = { ...host.info, online: false }
      this.log(`host offline: ${host.info.name} (${host.info.deviceId})`)
      this.broadcastHostsToClientsOf(host.token, host.info)
    }
    this.clients.delete(connId)
  }

  // ── inbound: host → relay ──────────────────────────────────────────────────

  handleHostMessage(conn: Connection, raw: string): void {
    const parsed = parseWith(HostToRelayEnvelopeSchema, raw)
    if (!parsed.ok) {
      this.log(`drop bad host frame from ${conn.id}: ${parsed.error}`)
      return
    }
    const env: HostToRelayEnvelope = parsed.value
    const msg = env.message

    if (msg.kind === "host.hello") {
      const record: HostConn = { conn, token: msg.token, info: { ...msg.info, online: true } }
      this.hostsByToken.set(msg.token, record)
      this.hostByConn.set(conn.id, record)
      this.log(`host online: ${record.info.name} (${record.info.deviceId})`)
      this.broadcastHostsToClientsOf(msg.token, record.info)
      return
    }

    const host = this.hostByConn.get(conn.id)
    if (!host) {
      this.log(`drop host frame before hello from ${conn.id}`)
      return
    }

    if (msg.kind === "host.state") {
      host.info = { ...msg.info, online: true }
      this.broadcastHostsToClientsOf(host.token, host.info)
      return
    }

    // events + snapshots: fan out verbatim to this host's clients.
    if (
      msg.kind === "event" ||
      msg.kind === "sessions.snapshot" ||
      msg.kind === "projects.snapshot"
    ) {
      this.forwardToClientsOf(host.token, raw)
    }
  }

  // ── inbound: client → relay ────────────────────────────────────────────────

  handleClientMessage(conn: Connection, raw: string): void {
    const parsed = parseWith(ClientToRelayEnvelopeSchema, raw)
    if (!parsed.ok) {
      this.log(`drop bad client frame from ${conn.id}: ${parsed.error}`)
      this.sendToClient(conn, { kind: "ack", ok: false, error: parsed.error })
      return
    }
    const env: ClientToRelayEnvelope = parsed.value
    const msg = env.message
    const client = this.clients.get(conn.id)
    if (!client) return

    if (msg.kind === "client.hello") {
      client.token = msg.token
      const host = this.hostsByToken.get(msg.token)
      this.sendToClient(conn, { kind: "ack", ok: true })
      // Immediately tell the client what host (if any) matches its token.
      this.sendToClient(conn, { kind: "hosts.list", hosts: host ? [host.info] : [] })
      this.log(`client ${conn.id} paired to token …${msg.token.slice(-4)}`)
      return
    }

    // Everything else requires a successful hello.
    if (!client.token) {
      this.sendToClient(conn, { kind: "ack", ok: false, error: "not paired" })
      return
    }

    if (msg.kind === "command") {
      const host = this.hostsByToken.get(client.token)
      if (!host) {
        this.sendToClient(conn, { kind: "ack", ok: false, error: "host offline" })
        return
      }
      // Forward the command verbatim to the host.
      host.conn.send(raw)
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private forwardToClientsOf(token: string, raw: string): void {
    for (const client of this.clients.values()) {
      if (client.token === token) client.conn.send(raw)
    }
  }

  private broadcastHostsToClientsOf(token: string, info: HostInfo): void {
    for (const client of this.clients.values()) {
      if (client.token === token) {
        this.sendToClient(client.conn, { kind: "hosts.list", hosts: [info] })
      }
    }
  }

  private sendToClient(conn: Connection, message: RelayToClient): void {
    const env = createEnvelope(message, { deviceId: "relay" })
    conn.send(serialize(env))
  }

  // ── introspection (for tests / health) ─────────────────────────────────────

  stats() {
    return {
      hosts: this.hostsByToken.size,
      clients: this.clients.size,
      pairedClients: [...this.clients.values()].filter((c) => c.token).length,
    }
  }
}
