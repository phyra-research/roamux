# OpenRemote

**A remote control plane for local AI coding agents.**

Your laptop stays the execution host — the coding agent, repo, shell,
filesystem, credentials, git state, and model access all live on your machine.
OpenRemote lets a **phone or remote browser** watch and steer that agent through
a relay, without ever exposing your machine.

For V0 the local agent runtime is **[OpenCode](https://opencode.ai)**. OpenRemote
does not implement its own coding agent — it drives one through a swappable
`AgentAdapter`.

```
Phone / Browser ──ws──▶ Relay ──ws──▶ Host Daemon ──localhost──▶ OpenCode ──▶ model
```

- The **relay never** touches your filesystem, repo, shell, credentials, or
  OpenCode server. It only routes authenticated messages.
- The **host dials out** to the relay. Nothing local is exposed publicly.
- Everything on the wire is an explicit, **Zod-validated, versioned** protocol
  message — never a raw internal object.

---

## Install & use (hosted beta)

The hosted control surface runs at **https://open-remote-sigma.vercel.app**.
Install the host CLI on any machine you want to control:

```sh
curl -fsSL https://open-remote-sigma.vercel.app/install.sh | sh
```

Then link the machine to your account and start it:

```sh
openremote login          # opens a code — approve it in your browser (sign in with GitHub)
cd ~/your/project         # the project the agent should work on
openremote host           # this machine now appears online in the web app
```

Open the web app on your **phone or browser**, sign in, pick your machine →
**New Session** → choose the project + agent + a task → **Start Agent**, and
watch it run live. Requires [OpenCode](https://opencode.ai) installed with a
model configured (`opencode auth login`).

CLI commands:

| Command | What it does |
| --- | --- |
| `openremote login` | Link this machine to your account (device-auth) |
| `openremote host` | Start the host daemon (run/serve your agents) |
| `openremote help` | Usage |
| `openremote version` | Version |

Useful env for `openremote host`: `DEFAULT_PROJECT_PATH=<dir>`,
`AGENT_ADAPTER=opencode|mock`, `HOST_NAME=<name>`.

> Building the CLI yourself: `OPENREMOTE_API_URL=… OPENREMOTE_ABLY_KEY=… bun run
> scripts/build-cli.ts` → binaries in `apps/web/public/cli/` (served at `/cli/*`).

---

## What's implemented (V0)

Milestones **1 and 2 are complete and verified end-to-end** (mock adapter *and*
a real local OpenCode server):

- ✅ See connected machines + online/offline state
- ✅ See active agent sessions
- ✅ Watch agent activity/events stream live (deltas, tools, files, messages)
- ✅ Send a new instruction to a session from the browser
- ✅ Stop an agent run remotely
- ✅ Approve / deny agent permission requests remotely (the headline feature)
- ✅ Per-session monotonic event **sequence numbers** (resume-ready)
- ✅ One-time-token pairing; host reconnect loop
- ✅ Mobile-first PWA-installable web UI
- ✅ `MockAgentAdapter` for running/testing the whole stack with no model
- ✅ `OpenCodeAdapter` verified against a live `opencode serve`

---

## Repository structure

```
openremote/
├── apps/
│   ├── host/      long-running daemon on your machine (dials the relay,
│   │              drives OpenCode via AgentAdapter, SQLite identity/sequence state)
│   ├── relay/     lightweight WebSocket router (Bun.serve). No agent logic.
│   └── web/       Next.js mobile-first control surface (PWA)
│
├── packages/
│   ├── protocol/        versioned envelopes, commands, events, sequencing (Zod)
│   └── agent-adapters/  AgentAdapter interface + MockAgentAdapter + OpenCodeAdapter
│
├── scripts/
│   ├── dev.ts               run relay + host(mock) + web together
│   ├── check.ts             typecheck + lint + tests gate (Definition of Done)
│   └── verify-opencode.ts   live smoke test of OpenCodeAdapter vs real OpenCode
│
├── CLAUDE.md / AGENTS.md    working agreement for humans and AI agents
├── tsconfig.base.json
└── README.md
```

The one boundary that never blurs:

```
OpenRemote protocol  ⇕  AgentAdapter  ⇕  OpenCode
```

`@opencode-ai/sdk` is imported in exactly one file: `OpenCodeAdapter`.

---

## Prerequisites

> 🛠️ **Contributing / running locally?** See **[CONTRIBUTING.md](CONTRIBUTING.md)**
> for the full clone → install → run → test guide (no cloud accounts needed for
> most work).

- **[Bun](https://bun.sh)** ≥ 1.4 (`curl -fsSL https://bun.sh/install | bash`)
- **[OpenCode](https://opencode.ai)** for the real path
  (`bun add -g opencode-ai`, then `opencode auth login` to configure a model)

You do **not** need OpenCode to run the whole stack with the mock adapter.

---

## Quick start

```bash
bun install
cp .env.example .env      # optional; sane defaults are built in

# Run relay + host(mock adapter) + web together:
bun run dev
```

Then, on your **laptop**:

1. Open **http://localhost:3000**.
2. The **host terminal prints a pairing token** — paste it into the web UI
   (or open the printed `…/pair?token=…` link, which pairs automatically).
3. You'll see the machine come **online** and a seeded mock session appear.
4. Open the session, type *"Inspect this repository and tell me what it does."*,
   hit **Send**, and watch events stream in live. Use **Stop** to abort.
5. Prompt with the word *"permission"* to exercise the **Allow / Deny** flow.

> The mock adapter is scripted (no model, no key) — it proves the whole pipe
> works end-to-end before you plug in a real agent.

### Access it from your phone (same Wi-Fi)

`localhost` won't work from a phone — the browser must dial your **laptop's LAN
IP**, and the relay must listen on all interfaces. Find your IP
(`ipconfig getifaddr en0` on macOS), then start with these set (edit `.env`, or
inline):

```bash
RELAY_HOST=0.0.0.0 \
NEXT_PUBLIC_RELAY_URL=ws://<LAPTOP_IP>:8787 \
WEB_URL=http://<LAPTOP_IP>:3000 \
bun run dev
```

On the phone (same Wi-Fi): open `http://<LAPTOP_IP>:3000`, then pair with the
token — easiest is to open the `http://<LAPTOP_IP>:3000/pair?token=…` link the
host prints. `.env.example` documents each variable.

> ⚠️ `NEXT_PUBLIC_*` is baked in at web startup — you must set it **before**
> `bun run dev`, not after. And `0.0.0.0` exposes the relay to everyone on your
> Wi-Fi: fine on a home network with the token, **not** on public Wi-Fi.
> Real per-device auth is a v1 task.

### Run against real OpenCode (real model output)

1. **Configure a model** OpenCode can call. Bring your own key:

   ```bash
   opencode auth login      # e.g. Anthropic → paste an API key
   ```

   > ⚠️ Use a **standard** API key, not a **workspace-scoped / identity-linked**
   > one. Workspace-scoped Anthropic keys fail with
   > `anthropic-workspace-id is required …` and the agent will return nothing.
   > (You can also point OpenCode at a local Ollama model — no key needed.)

2. **Start the host with the OpenCode adapter.** Leave `OPENCODE_URL` empty and
   the host spawns `opencode serve` on `127.0.0.1` for you. `DEFAULT_PROJECT_PATH`
   is the project OpenCode operates on — set it to an **absolute** path (it's used
   for both the spawn cwd and session listing, which must agree).

   ```bash
   AGENT_ADAPTER=opencode \
   DEFAULT_PROJECT_PATH=/abs/path/to/your/project \
   bun run dev:host          # + `bun run dev:relay` and `bun run dev:web`
   ```

   Or just set `AGENT_ADAPTER=opencode` in `.env` and run `bun run dev`.

3. Pair, open a session, send a prompt → **real model output streams to your
   phone/browser**. If a model call fails (bad key, no credit), you'll now see a
   clear **✗ Agent failed: …** instead of a silent "Done".

Verify just the adapter↔OpenCode boundary without the UI:

```bash
bun run scripts/verify-opencode.ts
```

---

## Commands

| Command                         | What it does                                        |
| ------------------------------- | --------------------------------------------------- |
| `bun install`                   | Install all workspaces                              |
| `bun run dev`                   | relay + host(mock) + web, prefixed logs             |
| `bun run dev:relay`             | relay only (`ws://127.0.0.1:8787`)                  |
| `bun run dev:host`              | host only (mock unless `AGENT_ADAPTER=opencode`)    |
| `bun run dev:web`               | web only (`http://localhost:3000`)                  |
| `bun test`                      | all unit + integration tests (43 tests)             |
| `bun run typecheck`             | strict typecheck across every workspace             |
| `bun run lint` / `lint:fix`     | Biome lint (+ autofix)                              |
| `bun run check`                 | **Definition of Done**: typecheck + lint + tests    |
| `bun run scripts/verify-opencode.ts` | live OpenCodeAdapter smoke test                |

### Environment variables

See [`.env.example`](.env.example). The important ones:

| Var                    | Default                 | Meaning                                  |
| ---------------------- | ----------------------- | ---------------------------------------- |
| `RELAY_PORT`           | `8787`                  | Relay listen port                        |
| `RELAY_URL`            | `ws://127.0.0.1:8787`   | Where the host dials the relay           |
| `AGENT_ADAPTER`        | `mock`                  | `mock` or `opencode`                     |
| `OPENCODE_URL`         | *(empty → auto-spawn)*  | Localhost OpenCode server URL            |
| `DEFAULT_PROJECT_PATH` | host cwd                | Project OpenCode operates on             |
| `HOST_NAME`            | machine hostname        | Name shown in the UI                     |
| `NEXT_PUBLIC_RELAY_URL`| `ws://127.0.0.1:8787`   | Where the browser dials the relay        |

---

## Architecture notes

> 📐 **V0 (as-built):** [docs/architecture.md](docs/architecture.md) —
> components, trust boundaries, the protocol, and sequence diagrams for
> pairing, prompting, streaming, stop, and permissions.
>
> 🚀 **Beta / V1 (design of record):**
> [docs/beta-architecture.md](docs/beta-architecture.md) — where we're taking it:
> multi-host, Ably transport, accounts, daemon-owned sessions, multiple agent
> harnesses, and the phased plan.

- **Protocol** (`packages/protocol`): `Envelope<T>` wraps every message with
  `protocolVersion`, `messageId`, `deviceId`, optional `sessionId` + `sequence`,
  and `timestamp`. Three directional unions (`ClientToRelay`, `HostToRelay`,
  `RelayToClient`) are each validated with Zod at the socket boundary.
- **Events** are normalized to a small vocabulary (`assistant.delta`,
  `tool.started/completed`, `permission.requested`, `agent.completed`, …) so the
  UI is agnostic to the runtime.
- **Relay** (`RelayCore`) is pure routing with zero transport deps — hosts
  register a pairing token, clients present the same token, commands flow
  client→host, events fan out host→clients. Fully unit-tested with fake sockets.
- **Host** attaches monotonic per-session sequence numbers (persisted in SQLite)
  before forwarding events, and reconnects with backoff.
- **Sequencing** exists from day one so **resume** (M3) is a routing change, not
  a protocol change.

---

## Security model (V0)

- OpenCode is bound to **127.0.0.1** only; an externally provided `OPENCODE_URL`
  is rejected unless it's localhost.
- The host makes the **outbound** connection; the relay can't dial in.
- The relay routes only between an **authenticated** client and its paired host.
- No shell/env/credentials ever cross to the relay. No arbitrary remote command
  execution — only the explicit protocol commands are honored, twice (Zod at the
  relay, a closed `switch` at the host).
- Pairing is a **one-time token** for V0. Proper device-keypair E2E pairing is
  planned for M3 — do not treat V0 pairing as production-grade auth.

---

## Known limitations (V0)

- **Pairing is a shared bearer token**, not per-device keys. Anyone with the
  token who can reach the relay can pair. Fine for LAN/dev; not production auth.
- The bundled relay binds to `127.0.0.1` by default. To use your phone over the
  internet you must run the relay somewhere reachable (and add TLS + real auth
  first). No hosted relay is provided.
- **Event delivery is at-most-once.** If the host↔relay socket is down when an
  event fires, that event is dropped. Sequence numbers are recorded but
  **resume/replay is not implemented yet** (M3).
- **No git diff / file-change inspection UI yet** (M3). `file.changed` events are
  shown as lines only.
- Without a model configured in OpenCode (`opencode auth login`), real sessions
  connect and stream lifecycle events but the model produces no tokens. A failed
  model call now surfaces as **✗ Agent failed: …** rather than a silent "Done".
- Text streaming assumes OpenCode sends the growing full text per part (this
  build does); the adapter computes deltas itself. A future OpenCode build that
  changes this shape may need the normalizer updated.
- Web UI reconnect is basic; deep app-state resync on reconnect is minimal.
- Serving over a plain LAN IP (`http://<ip>`) is a non-secure context, so the
  web app avoids `crypto.randomUUID` (uses a `getRandomValues` fallback).

---

## Next three engineering tasks

1. **Reconnect-safe event resume (M3 core).** Persist a bounded per-session
   event log on the host, have the client send its last-seen `sequence` on
   (re)subscribe, and have the host replay the gap. Turns at-most-once delivery
   into resumable at-least-once.
2. **Real pairing: device keypairs + relay auth.** Replace the shared token with
   per-device keypairs, a signed pairing handshake, and a relay that binds
   client↔host associations to verified device identities. Add QR pairing.
3. **Git diff viewing.** Add `session.diff` protocol messages backed by
   OpenCode's `/session/{id}/diff` (and `/vcs/diff`), plus a mobile-friendly
   diff view — the first "inspect file changes" surface.

---

## Contributing

Read **[CLAUDE.md](CLAUDE.md)** (aliased as `AGENTS.md`) first — it's the working
agreement for every contributor, human or AI. Before any commit:

```bash
bun run check      # typecheck + lint + tests must be green
```

A git pre-commit hook enforces this once you run:

```bash
git config core.hooksPath .githooks
```

## License

MIT (see `LICENSE` when added).
