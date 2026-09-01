import { startRelayServer } from "./server.js"

const PORT = Number(process.env.RELAY_PORT ?? 8787)
const HOST = process.env.RELAY_HOST ?? "127.0.0.1"

const { server } = startRelayServer({
  port: PORT,
  hostname: HOST,
  log: (m) => console.log(`[relay] ${m}`),
})

console.log(`[relay] listening on ws://${HOST}:${server.port}  (/host, /client)`)
console.log(`[relay] health: http://${HOST}:${server.port}/health`)
