import { newId } from "@openremote/protocol"
import type { Server, ServerWebSocket } from "bun"
import { type Connection, RelayCore } from "./core.js"

type Role = "host" | "client"
export type SocketData = { id: string; role: Role }

export type RelayServerOptions = {
  port?: number
  hostname?: string
  log?: (msg: string) => void
}

/** Wrap a Bun ServerWebSocket as a transport-agnostic Connection. */
function toConnection(ws: ServerWebSocket<SocketData>): Connection {
  return {
    id: ws.data.id,
    send: (data) => {
      if (ws.readyState === 1) ws.send(data)
    },
    close: () => ws.close(),
  }
}

/**
 * Create and start a relay server. Returned so both the CLI entrypoint and
 * integration tests can drive it. `server.stop()` shuts it down.
 */
export function startRelayServer(opts: RelayServerOptions = {}): {
  server: Server<SocketData>
  core: RelayCore
} {
  const log = opts.log ?? (() => {})
  const core = new RelayCore({ log })

  const server = Bun.serve<SocketData, string>({
    port: opts.port ?? 8787,
    hostname: opts.hostname ?? "127.0.0.1",
    fetch(req, srv) {
      const url = new URL(req.url)
      if (url.pathname === "/health") {
        return Response.json({ ok: true, ...core.stats() })
      }
      let role: Role | null = null
      if (url.pathname === "/host") role = "host"
      else if (url.pathname === "/client") role = "client"
      if (role) {
        const ok = srv.upgrade(req, { data: { id: newId(), role } })
        if (ok) return undefined
        return new Response("upgrade failed", { status: 400 })
      }
      return new Response("OpenRemote relay. Connect to /host or /client via WebSocket.", {
        status: 404,
      })
    },
    websocket: {
      open(ws) {
        if (ws.data.role === "client") core.addClient(toConnection(ws))
      },
      message(ws, message) {
        const raw = typeof message === "string" ? message : new TextDecoder().decode(message)
        const conn = toConnection(ws)
        if (ws.data.role === "host") core.handleHostMessage(conn, raw)
        else core.handleClientMessage(conn, raw)
      },
      close(ws) {
        core.removeConnection(ws.data.id)
      },
    },
  })

  return { server, core }
}
