#!/usr/bin/env bun
/**
 * Dev orchestrator: starts the relay, host (mock adapter by default), and web
 * app together with prefixed, colorized logs. Ctrl-C stops all three.
 *
 * For the real-OpenCode path, run the host separately with AGENT_ADAPTER=opencode
 * (see README) — this script defaults the host to the mock adapter so the whole
 * slice runs with zero external services.
 */
import { type ChildProcess, spawn } from "node:child_process"

type Service = {
  name: string
  color: string
  cwd: string
  cmd: string[]
  env?: Record<string, string>
}

const RESET = "\x1b[0m"

const services: Service[] = [
  {
    name: "relay",
    color: "\x1b[35m",
    cwd: "apps/relay",
    cmd: ["bun", "run", "--watch", "src/index.ts"],
  },
  {
    name: "host",
    color: "\x1b[36m",
    cwd: "apps/host",
    cmd: ["bun", "run", "--watch", "src/index.ts"],
    env: { AGENT_ADAPTER: process.env.AGENT_ADAPTER ?? "mock" },
  },
  { name: "web", color: "\x1b[32m", cwd: "apps/web", cmd: ["bun", "run", "dev"] },
]

const children: ChildProcess[] = []

function start(service: Service): void {
  const [bin, ...args] = service.cmd
  const child = spawn(bin as string, args, {
    cwd: service.cwd,
    env: { ...process.env, ...service.env },
    stdio: ["ignore", "pipe", "pipe"],
  })
  children.push(child)

  const prefix = `${service.color}[${service.name}]${RESET} `
  const pipe = (data: Buffer, stream: NodeJS.WriteStream) => {
    for (const line of data.toString().split("\n")) {
      if (line.length) stream.write(`${prefix}${line}\n`)
    }
  }
  child.stdout?.on("data", (d) => pipe(d, process.stdout))
  child.stderr?.on("data", (d) => pipe(d, process.stderr))
  child.on("exit", (code) => {
    process.stdout.write(`${prefix}exited with code ${code}\n`)
  })
}

for (const service of services) start(service)

const shutdown = () => {
  for (const child of children) child.kill("SIGINT")
  setTimeout(() => process.exit(0), 300)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

process.stdout.write("\nOpenRemote dev: relay + host(mock) + web starting…\n")
process.stdout.write("Web:   http://localhost:3000\n")
process.stdout.write("Relay: ws://127.0.0.1:8787  (health: http://127.0.0.1:8787/health)\n\n")
