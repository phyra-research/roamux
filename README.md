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

## Prerequisites

roamux **drives an agent you already run locally** — it does not ship or proxy a
model. So before you start, install and sign in to **one** of the supported
agent CLIs on the machine you want to control (this is where your model access
and auth live — nothing leaves the box):

| Agent | Install | Sign in |
| --- | --- | --- |
| **[OpenCode](https://opencode.ai)** | `curl -fsSL https://opencode.ai/install \| bash` | `opencode auth login` |
| **[Claude Code](https://claude.com/claude-code)** | `curl -fsSL https://claude.ai/install.sh \| bash` | `claude` (run once, complete the login) |
| **Codex** | `npm install -g @openai/codex` | `codex login` |

You only need one. If the agent isn't installed or signed in, `roamux host`
refuses to start and prints the exact commands to fix it.

## Quick start

**On the machine you want to control** (macOS or Linux):

```sh
# 1. Install the host CLI
curl -fsSL https://remote.phyra.ai/install.sh | sh

# 2. Link it to your account (opens a code — approve it in your browser)
roamux login

# 3. Start it in the project you want the agent to work on, picking the agent.
#    AGENT_ADAPTER defaults to `opencode` — set it for Claude Code or Codex.
cd ~/your/project
AGENT_ADAPTER=claude-code roamux host      # or opencode | codex
```

Then open **[the web app](https://remote.phyra.ai)** on your phone
or browser, sign in, pick your machine → **New Session** → choose the project +
agent + a task → **Start**, and watch it run.

> A host serves **one** agent — whichever `AGENT_ADAPTER` you launched it with.
> To offer several, run one host per agent.

> **File edits:** the agent auto-accepts file edits so it can actually do the
> work (it still won't run destructive shell commands unattended). Point it at a
> project you're comfortable letting it change — a git repo is ideal.

> **Keep it running in the background** (survives closing the terminal / logout):
> `roamux service install`

### CLI

| Command | What it does |
| --- | --- |
| `roamux login` | Link this machine to your account (device authorization) |
| `roamux host` | Start the host daemon and serve your agents |
| `roamux service install` | Install the host as a background service (launchd / systemd) |
| `roamux service status` / `uninstall` | Manage the background service |
| `roamux help` · `roamux version` | Usage / version |

Configure via env: `AGENT_ADAPTER=opencode|claude-code|codex` picks the agent
(default `opencode`), `DEFAULT_PROJECT_PATH=<dir>` sets the project (default: the
current directory), `HOST_NAME=<name>` labels the machine.

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

## Use it from an AI client (MCP)

Besides the web app, roamux exposes its control surface as an **MCP server** —
so you can drive your hosts straight from an MCP-capable chat client (Claude
desktop/mobile, ChatGPT, …). The chat app becomes the UI; roamux routes the
commands to the agent running on your machine. It's **additive** — the web app
is unchanged, and an MCP client can do only what a browser session can (the same
small, validated command set).

### How it works

```
Claude / ChatGPT ──▶ https://remote.phyra.ai/api/mcp ──▶ Ably ──▶ your host ──▶ agent
     (MCP client)         (roamux MCP server, OAuth)        (scoped per user)
```

1. **Connect once.** Add the roamux MCP server to your client as a custom/remote
   connector: **`https://remote.phyra.ai/api/mcp`**. The client auto-discovers
   the auth flow and opens a sign-in — you log in with your existing roamux
   (GitHub) account. That's it; no keys to paste.
2. **The client gets a scoped token.** roamux acts as an OAuth 2.1 server (PKCE)
   that delegates login to your account, then issues a short-lived token carrying
   only your user id. Every tool call is scoped to **your** hosts — a token can
   never reach anyone else's machines. The raw realtime key never leaves roamux.
3. **Chat to drive your agent.** The client calls roamux tools under the hood.

### What you can say

> "Using roamux, list the projects on host `<hostId>`."
>
> "Start a claude-code session on host `<hostId>` in that project and have it fix
> the failing test."
>
> "What's the latest activity on that session?"

> **Finding your `hostId`:** for now, grab it from your machines list in the
> roamux web app and pass it to the client. (A `list_hosts` tool to skip this is
> on the roadmap.)

### The tools

| Tool | Does |
| --- | --- |
| `roamux_list_sessions` | sessions on a host |
| `roamux_list_projects` | approved projects + installed agents (valid `start_session` inputs) |
| `roamux_start_session` | start a session for a project + agent |
| `roamux_send_prompt` | send an instruction to a session |
| `roamux_get_activity` | poll a session's recent activity |
| `roamux_stop_session` | stop a session |
| `roamux_respond_permission` | allow/deny a permission the agent is waiting on |

There is **no generic "run anything" tool** — the surface mirrors roamux's closed
command set. A local **stdio** variant (for Claude Desktop on the same machine)
also ships; see [apps/mcp/README.md](apps/mcp/README.md). Self-hosting the remote
server: see [DEPLOY.md](DEPLOY.md) + [apps/mcp/REMOTE-DESIGN.md](apps/mcp/REMOTE-DESIGN.md).

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
