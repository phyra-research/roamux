import type { Subprocess } from "bun"

/**
 * Spawn a local `opencode serve` bound to 127.0.0.1 and resolve its base URL.
 * Enforces the localhost-only invariant (CLAUDE.md §3) — we never pass a public
 * hostname. Returns the URL plus a stop() handle.
 *
 * OpenCode prints a line like `opencode server listening on http://127.0.0.1:PORT`
 * to stdout; we parse the first http URL we see.
 */
export type SpawnedOpenCode = {
  url: string
  stop: () => void
}

export async function spawnOpenCode(
  opts: { cwd: string; timeoutMs?: number } = { cwd: process.cwd() },
): Promise<SpawnedOpenCode> {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const proc: Subprocess = Bun.spawn(
    ["opencode", "serve", "--hostname", "127.0.0.1", "--port", "0"],
    {
      cwd: opts.cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    },
  )

  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("timed out waiting for opencode server URL"))
    }, timeoutMs)

    const scan = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const match = buf.match(/https?:\/\/127\.0\.0\.1:\d+/)
        if (match) {
          clearTimeout(timer)
          resolve(match[0])
          return
        }
      }
    }

    void scan(proc.stdout as ReadableStream<Uint8Array>)
    void scan(proc.stderr as ReadableStream<Uint8Array>)

    proc.exited.then((code) => {
      clearTimeout(timer)
      reject(new Error(`opencode server exited early with code ${code}`))
    })
  })

  return {
    url,
    stop: () => {
      try {
        proc.kill()
      } catch {
        // already gone
      }
    },
  }
}
