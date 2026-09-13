<div align="center">

# roamux

**Run AI coding agents on your own machines. Control them from anywhere.**

Your computer stays the execution host — the agent, your repo, shell, files,
git state, credentials, and model access never leave it. A phone or browser
signs in and steers the agent live.

[Quick start](#quick-start) · [How it works](#how-it-works) · [Contributing](CONTRIBUTING.md) · [Architecture](docs/architecture.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-black)

</div>

---

## What it is

roamux is a **remote control plane for AI coding agents running on machines
you own**. Install a small host daemon on any computer; it dials out to the
cloud and lets your authenticated devices watch and steer its agents. From your
phone you can:

- see your connected machines and their live agent sessions,
- start a new session (pick a machine, a project, and an agent) and send tasks,
- watch activity stream in real time,
- approve or deny the agent's permission requests,
- stop a run, and review the files it changed.

**Your code never leaves your machine.** The cloud routes structured control
messages and stores only metadata (labels and ids) — never your files, paths,
credentials, or model keys.

Supported agents (bring your own): **[OpenCode](https://opencode.ai)**,
**[Claude Code](https://claude.com/claude-code)**, and **Codex**. roamux
does not implement its own agent — it drives yours through a swappable
`HarnessAdapter`.

## Quick start

**On the machine you want to control** (macOS or Linux):

```sh
# 1. Install the host CLI
curl -fsSL https://remote.phyra.ai/install.sh | sh

# 2. Link it to your account (opens a code — approve it in your browser)
roamux login

# 3. Start it in the project you want the agent to work on
cd ~/your/project
roamux host
```

Then open **[the web app](https://remote.phyra.ai)** on your phone
or browser, sign in, pick your machine → **New Session** → choose the project +
agent + a task → **Start**, and watch it run.

> **Keep it running in the background** (survives closing the terminal / logout):
> `roamux service install`

> You need one of the supported agent CLIs installed and configured on the host
> ([OpenCode](https://opencode.ai) `opencode auth login`, or
> [Claude Code](https://claude.com/claude-code), or Codex). The host tells you
> exactly what's missing on startup.

### CLI

| Command | What it does |
| --- | --- |
| `roamux login` | Link this machine to your account (device authorization) |
| `roamux host` | Start the host daemon and serve your agents |
| `roamux service install` | Install the host as a background service (launchd / systemd) |
| `roamux service status` / `uninstall` | Manage the background service |
| `roamux help` · `roamux version` | Usage / version |

Pick the agent with `AGENT_ADAPTER=opencode|claude-code|codex` and the project
with `DEFAULT_PROJECT_PATH=<dir>`.

## How it works

```
Phone / Browser ─▶ roamux Cloud (web + API)        your machine
      │                 │  auth · host & session registry     host daemon ─▶ agent ─▶ model
      │                 │  mints scoped realtime tokens              ▲
      └─────────────── realtime transport (Ably) ─────────────────────┘   (host dials OUT)
```

Three boundaries carry the whole design:

- **Protocol** (`packages/protocol`) — every message on the wire is a
  **versioned, Zod-validated** envelope. No raw internal objects, ever.
- **Transport** — how bytes move, behind one interface: a local WebSocket relay
  for development, and [Ably](https://ably.com) in production. Swappable.
- **HarnessAdapter** (`packages/agent-adapters`) — how a runtime is driven.
  Agent-specific code lives *only* inside its adapter; the rest of the system
  speaks one normalized event vocabulary.

**Security invariants** (enforced in code and tests):

- the agent runtime binds to **localhost only**;
- the **host dials out** — nothing local is exposed via an inbound port;
- routing is authenticated and **scoped per user**, so one account can never
  reach another's machines;
- there is **no arbitrary remote shell** — clients send a small set of explicit,
  validated commands, never shell strings or filesystem paths;
- repos, credentials, env vars, and model keys **never cross the wire**.

Full write-ups, with diagrams, in [docs/architecture.md](docs/architecture.md)
(the as-built local slice) and
[docs/beta-architecture.md](docs/beta-architecture.md) (the multi-host, hosted
design of record).

## Repository layout

```
apps/
  host/    the daemon + `roamux` CLI. Runs on the user's machine, dials out,
           owns sessions. Compiles to a single binary.
  relay/   local-dev WebSocket router (not used in production — Ably replaces it).
  web/     Next.js — the mobile-first control UI + API + auth. Deploys to Vercel.
packages/
  protocol/        Zod envelopes, commands/events, the Transport interface, channels.
  agent-adapters/  HarnessAdapter + OpenCode / Claude Code / Codex + a mock for tests.
  db/              Postgres schema, migration runner, typed repositories.
docs/              architecture and design docs.
```

## Development

You do **not** need any cloud accounts to develop. The fastest path:

```sh
bun install
bun run dev        # relay + host (mock agent) + web at http://localhost:3000
```

Full guide — local database, real agents, running the test suite —
in **[CONTRIBUTING.md](CONTRIBUTING.md)**. Before opening a PR:

```sh
bun run check      # typecheck + lint + tests — must be green
```

## Tech stack

TypeScript (strict) · [Bun](https://bun.sh) · [Next.js](https://nextjs.org) ·
[Zod](https://zod.dev) · [Ably](https://ably.com) (realtime) ·
[Supabase](https://supabase.com) (Postgres + auth) · deployed on
[Vercel](https://vercel.com).

## Contributing

Contributions are welcome. Start with **[CONTRIBUTING.md](CONTRIBUTING.md)** for
setup, and [CLAUDE.md](CLAUDE.md) (aliased `AGENTS.md`) for the working agreement
every contributor — human or AI coding agent — follows. Keep `bun run check`
green and never weaken a security invariant silently.

## License

[MIT](LICENSE)
