/**
 * Preflight checks for `roamux host`. Catches the things that silently break
 * the experience — the agent CLI not installed, or not usable (no model / not
 * signed in) — and prints actionable guidance instead of a cryptic spawn error
 * or empty agent replies. One function per supported adapter.
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
      "OpenCode is not installed — that's the agent roamux runs.",
      "",
      "  Install it:",
      "    curl -fsSL https://opencode.ai/install | bash",
      "    (or: brew install sst/tap/opencode)",
      "",
      "  Then configure a model:",
      "    opencode auth login        # e.g. Anthropic — paste an API key",
      "    (or point it at a free local model via Ollama — see opencode.ai/docs)",
      "",
      "  Re-run `roamux host` once OpenCode is set up.",
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
      "  Then re-run `roamux host`.",
    )
    return { ok: false, messages }
  }

  return { ok: true, messages }
}

/** Does `codex login status` report a logged-in account? */
async function codexIsAuthed(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["codex", "login", "status"], { stdout: "pipe", stderr: "pipe" })
    await proc.exited
    if (proc.exitCode !== 0) return false
    // `codex login status` prints its human-readable status to STDERR, not
    // stdout (verified) — check both so a future version swapping streams
    // doesn't silently break this.
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    // "Logged in using …" vs "Not logged in" — anchor so the latter doesn't
    // false-match on the "logged in" substring it also contains.
    return /^logged in/i.test(out.trim()) || /^logged in/i.test(err.trim())
  } catch {
    return false
  }
}

/** Does `claude auth status` report a logged-in account? */
async function claudeIsAuthed(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["claude", "auth", "status"], { stdout: "pipe", stderr: "pipe" })
    await proc.exited
    if (proc.exitCode !== 0) return false
    const out = await new Response(proc.stdout).text()
    return /"loggedIn"\s*:\s*true/.test(out)
  } catch {
    return false
  }
}

/**
 * Run Codex preflight. Same shape as `preflightOpenCode` — ok=false with
 * guidance when the CLI is missing or not signed in.
 */
export async function preflightCodex(): Promise<PreflightResult> {
  const messages: string[] = []

  if (!(await commandExists("codex"))) {
    messages.push(
      "Codex is not installed — that's the agent roamux would run.",
      "",
      "  Install it:",
      "    npm install -g @openai/codex",
      "    (see https://developers.openai.com/codex/cli for other options)",
      "",
      "  Then sign in:",
      "    codex login",
      "",
      "  Re-run `roamux host` once Codex is set up.",
    )
    return { ok: false, messages }
  }

  if (!(await codexIsAuthed())) {
    messages.push(
      "Codex is installed, but not signed in — the agent would fail every run.",
      "Sign in:",
      "",
      "    codex login",
      "",
      "  Then re-run `roamux host`.",
    )
    return { ok: false, messages }
  }

  return { ok: true, messages }
}

/**
 * Run Claude Code preflight. Same shape as `preflightOpenCode` — ok=false with
 * guidance when the CLI is missing or not signed in.
 */
export async function preflightClaudeCode(): Promise<PreflightResult> {
  const messages: string[] = []

  if (!(await commandExists("claude"))) {
    messages.push(
      "Claude Code is not installed — that's the agent roamux would run.",
      "",
      "  Install it:",
      "    curl -fsSL https://claude.ai/install.sh | bash",
      "    (see https://docs.claude.com/en/docs/claude-code for other options)",
      "",
      "  Then sign in:",
      "    claude          # run once, complete the login prompt",
      "",
      "  Re-run `roamux host` once Claude Code is set up.",
    )
    return { ok: false, messages }
  }

  if (!(await claudeIsAuthed())) {
    messages.push(
      "Claude Code is installed, but not signed in — the agent would fail every",
      "run. Sign in:",
      "",
      "    claude          # run once, complete the login prompt",
      "    (or set ANTHROPIC_API_KEY in this shell)",
      "",
      "  Then re-run `roamux host`.",
    )
    return { ok: false, messages }
  }

  return { ok: true, messages }
}
