/**
 * Preflight checks for `openremote host` with the OpenCode adapter. Catches the
 * two things that silently break the experience — OpenCode not installed, or no
 * model configured — and prints actionable guidance instead of a cryptic spawn
 * error or empty agent replies.
 */

export type PreflightResult = { ok: boolean; messages: string[] }

/** Is a command available on PATH? */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", cmd], { stdout: "pipe", stderr: "pipe" })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}

/** Does OpenCode have any model credential configured? */
async function opencodeHasModel(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["opencode", "auth", "list"], { stdout: "pipe", stderr: "pipe" })
    await proc.exited
    const out = await new Response(proc.stdout).text()
    // `opencode auth list` prints "N credentials" — any provider row means a key.
    return /●|\b[1-9]\d* credential/.test(out)
  } catch {
    return false
  }
}

/**
 * Run OpenCode preflight. Returns ok=false with guidance if something's missing,
 * so the caller can print it and exit cleanly rather than crash.
 */
export async function preflightOpenCode(): Promise<PreflightResult> {
  const messages: string[] = []

  if (!(await commandExists("opencode"))) {
    messages.push(
      "OpenCode is not installed — that's the agent OpenRemote runs.",
      "",
      "  Install it:",
      "    curl -fsSL https://opencode.ai/install | bash",
      "    (or: brew install sst/tap/opencode)",
      "",
      "  Then configure a model:",
      "    opencode auth login        # e.g. Anthropic — paste an API key",
      "    (or point it at a free local model via Ollama — see opencode.ai/docs)",
      "",
      "  Re-run `openremote host` once OpenCode is set up.",
    )
    return { ok: false, messages }
  }

  if (!(await opencodeHasModel())) {
    messages.push(
      "OpenCode is installed, but no model is configured — the agent would return",
      "nothing. Configure one:",
      "",
      "    opencode auth login        # e.g. Anthropic — paste an API key",
      "    (or a free local model via Ollama — see opencode.ai/docs)",
      "",
      "  Then re-run `openremote host`.",
    )
    return { ok: false, messages }
  }

  return { ok: true, messages }
}
