# CLAUDE.md — Working agreement for OpenRemote

This file is the contract for **every** contributor to this repo, human or AI
coding agent (Claude Code, OpenCode, Cursor, Aider, …). Read it before you
touch code. If you are an agent, treat this as a hard constraint, not advice.

> **New here / setting up locally?** See [`CONTRIBUTING.md`](CONTRIBUTING.md) for
> the clone → install → run → test guide. This file is the *rules*; that one is
> the *how-to-run*.

> **Status (keep this current):** OpenRemote is **deployed and live** — a
> multi-host beta at `https://remote.phyra.ai`. Phases P0–P3 have
> shipped (foundations, Ably transport, accounts+multi-host, agent beta) plus a
> downloadable CLI. Remaining work is tracked as GitHub issues **#44–#55**
> (hardening, Phase-4 polish, post-beta). Do not treat this as an unbuilt V0.

---

## 1. What OpenRemote is

A **remote control plane for AI coding agents that run on machines the user
owns.** Your machine stays the execution host — the agent, repo, shell,
filesystem, credentials, git state, and model access all live there. A phone or
browser signs in and steers that agent.

```
Phone / Browser ─▶ Vercel (web + API)          your machine
      │                 │  mints Ably tokens        host daemon ─▶ OpenCode ─▶ model
      │                 │  Supabase: auth + metadata      ▲
      └─────────────── Ably (realtime) ──────────────────┘   (host dials OUT)
```

The agent runtime is **OpenCode** (bring-your-own-model). We do **not** implement
our own coding agent — we drive one through a swappable `HarnessAdapter`.

Two horizons, kept in separate docs — **read them**:
- [`docs/architecture.md`](docs/architecture.md) — V0 as-built (the local slice).
- [`docs/beta-architecture.md`](docs/beta-architecture.md) — the beta/live design
  of record (multi-host, Ably, accounts). This is what's deployed.

## 2. The boundaries that must never blur

Three seams carry the whole design. Everything else may be small, dumb, and
replaceable; these are not.

```
Client ⇔ Transport ⇔ OpenRemote protocol ⇔ HarnessAdapter ⇔ Agent runtime
          (WS | Ably)   (Zod envelopes)     (OpenCode…)
                             ⇕
                     HostSessionManager   (owns session lifecycle)
```

- **Protocol** (`packages/protocol`): all client↔host traffic is **versioned,
  Zod-validated** envelopes. Never put a raw internal object on the wire.
- **Transport** (`Transport` in `packages/protocol`): how bytes move.
  `WebSocketTransport` (local relay, dev) and `AblyTransport` (prod). Swappable —
  the protocol/adapters never know which is underneath.
- **HarnessAdapter** (`packages/agent-adapters`): how we drive a runtime.
  OpenCode-specific code (and `@opencode-ai/sdk`) lives **only** in
  `OpenCodeAdapter`. Importing that SDK anywhere else leaks the abstraction —
  stop.
- **HostSessionManager** (`apps/host`): validates + owns daemon sessions
  (approved project + installed harness). Clients reference a `projectId`, never
  a filesystem path.

## 3. Security invariants (do not violate, ever)

1. OpenCode listens on **localhost only**. Never bind it to a public interface.
2. The **host dials out** (to the relay, or to Ably). Nothing on the host is
   exposed via an inbound port. The cloud never dials the host.
3. Routing is **authenticated**: clients act as a signed-in user (Supabase);
   hosts prove a host credential. Ably tokens are **scoped** to
   `openremote:user:{userId}:*` so one user can never reach another's channels.
4. **Never send shell credentials, env vars, model keys, repos, or file contents
   over the wire.** Postgres stores metadata only (labels/ids), never paths or
   secrets. The host maps `projectId` → local path.
5. No arbitrary remote shell / code execution. Only the explicit `RemoteCommand`
   variants do anything — validated with Zod and a closed `switch`.
6. Secrets (Ably key, Supabase service-role key, host secrets) stay **server-side
   or host-local**. The browser gets short-lived scoped tokens, never raw keys.
   Store host secrets hashed.

If a change would weaken any of these, it does not ship. Flag it instead.

## 4. Engineering principle

Prefer, at every step:

```
small · working · observable · testable
```

over

```
large · generic · enterprise-ready
```

Do **not** build abstraction purity before an end-to-end path works. Build the
vertical slice, run it, watch events flow, then generalize. The one exception is
the seams in §2 — those we design up front.

## 5. How the system is wired (dev vs prod)

Everything is **env-driven** — the same code runs locally or in prod, differing
only by environment variables (never hardcode URLs/keys).

| | Local dev | Production (live) |
|---|---|---|
| Transport | relay WebSocket (`apps/relay`) | **Ably** (no relay) |
| DB / Auth | Docker Postgres / local Supabase | **Supabase Cloud** |
| Web + API | `bun run dev` | **Vercel** (`apps/web`) |
| Host | `bun run apps/host/src/index.ts` | installed `openremote` binary |

### Run it locally (quick reference — full guide in [`CONTRIBUTING.md`](CONTRIBUTING.md))

**No cloud accounts / no GitHub login are needed to develop.** Three levels:

```sh
# A) Whole slice with a FAKE agent — no cloud, no key, no login:
bun install && bun run dev            # relay + host(mock) + web at :3000

# B) Real OpenCode agent (needs `opencode auth login`):
AGENT_ADAPTER=opencode DEFAULT_PROJECT_PATH=/abs/project bun run dev:host

# C) Full UI + API + DB with NO GitHub/Supabase (dev-auth bypass):
bun run db:up && bun run db:migrate               # local Postgres
cp .env.local.example apps/web/.env.local         # ready-made no-auth env
bun run dev:web                                    # "signed in" as a dev user
```

Level C works because with Supabase env unset, the API treats you as the fixed
`OPENREMOTE_DEV_AUTH_SUBJECT` user and the UI login gate is satisfied by
`/api/me` — so you never hit a GitHub sign-in. Tests: `bun test` (no DB) /
`bun run db:test` (needs `db:up`).

- Migrations live in **`supabase/migrations/`** (single source; Supabase's GitHub
  integration applies them, and `bun run db:migrate` runs the same files locally).
- The CLI (`apps/host`) compiles to a single binary via
  `scripts/build-cli.ts` with config baked in (`bun build --define`).
- **Known gotcha:** Ably's browser build breaks webpack, so the web client loads
  Ably from its **CDN** at runtime (`ably-browser.ts`) — keep it out of the
  bundle.

## 6. Repo layout

```
apps/
  host/    the daemon + `openremote` CLI (login / host / help). Runs on the user's
           machine, dials out, owns sessions, heartbeats status. Compiles to a binary.
  relay/   local-dev WebSocket router (Bun.serve). NOT used in prod (Ably replaces it).
  web/     Next.js — mobile-first control UI + the API (app/api/*: hosts, device-auth,
           ably token minting, heartbeat) + Supabase auth. Deploys to Vercel.
packages/
  protocol/        Zod envelopes, commands/events, Transport (WS + Ably), channels.
  agent-adapters/  HarnessAdapter interface + MockAgentAdapter + OpenCodeAdapter.
  db/              Postgres (postgres.js) schema, migration runner, typed repos.
supabase/          config.toml + migrations/ (control-plane schema; also prod migrations).
scripts/           dev orchestration, check.ts, build-cli.ts.
docs/              architecture.md (V0) + beta-architecture.md (live design of record).
DEPLOY.md          Vercel + Supabase + GitHub-OAuth + host setup checklist.
```

## 7. House style

- **TypeScript everywhere**, strict. No `any` without a `// why:` comment.
- Runtime & package manager: **Bun**. `bun install`, `bun test`, `bun run dev`.
- Formatting & linting: **Biome**. Double quotes, no semicolons, trailing commas.
- Validation: **Zod**. Parse at every trust boundary (socket in, request in, DB row out).
- Naming: `kebab-case` files, `PascalCase` types, `camelCase` values.
- Keep functions short. Keep modules single-purpose. Comment the *why*, not the *what*.

## 8. Definition of done — run before every commit / handoff

```bash
bun run check      # typecheck + biome + tests, all must pass
```

Enforced by `scripts/check.ts` and the pre-commit hook (`.githooks/pre-commit`,
enabled via `git config core.hooksPath .githooks`). A change is not "done" until:

1. `bun run check` is green.
2. New behavior has a test (protocol → serialization test; adapter/handler →
   unit test with `MockAgentAdapter`, never a live model). DB repos have opt-in
   integration tests behind `RUN_DB_TESTS=1` (skipped by default).
3. If you touched the web app, `next build` still passes (it's the Vercel gate).
4. The security invariants in §3 still hold.
5. Docs updated if you changed how to run/configure/deploy anything — including
   the **Status** banner at the top of this file if the milestone picture moved.

## 9. For AI agents specifically (Claude Code, OpenCode, Cursor, Aider, …)

Most contributors here drive a coding agent to build, commit, and open PRs.
These are hard rules for that workflow — follow them exactly.

### Working style
- Prefer editing existing files over adding new ones. Match surrounding style;
  comment the *why*, not the *what*.
- Understand before you change: read [`CONTRIBUTING.md`](CONTRIBUTING.md) (how to
  run) and the relevant `docs/` before touching an unfamiliar area.
- Tests must never depend on a real model, network, or a specific machine. Use
  `MockAgentAdapter`; gate DB tests behind `RUN_DB_TESTS=1`.
- If a task pushes you to break §2 (boundaries) or §3 (security), do **not** do
  it silently — stop, surface the conflict, and propose an alternative.

### Definition of done (every task)
Leave the repo green. Before you consider a change complete:
```sh
bun run check          # typecheck + Biome + tests — MUST pass
# if you touched apps/web:
cd apps/web && bun run build   # the Vercel deploy gate
```

### Git / branch / commit / PR flow
- **Never commit or push unless the human asks.** When asked:
  - Work on a **branch off `main`** (e.g. `feat/…`, `fix/…`), never commit
    straight to `main` unless told to.
  - Keep commits focused; write a clear body explaining *why*.
  - End every commit message with the co-author trailer the human uses.
- **Opening a PR:** target `main`, give it a descriptive title + a body that says
  what changed, why, and how it was verified. Link issues with `Closes #NN`.
- **This repo's git trap — the CLI binaries:** `apps/web/public/cli/*` are large
  (~60–80 MB) committed binaries. Staging them can **OOM-kill `git commit`** and
  the pre-commit hook chokes on them. For any PR that is *not* deliberately
  updating the binaries: **restore them out of the diff and commit source only**
  (`git checkout -- apps/web/public/cli/`). Moving them off git is issue #44.
- The pre-commit hook (`.githooks/pre-commit`, enable with
  `git config core.hooksPath .githooks`) runs `bun run check`. Don't bypass it
  with `--no-verify` unless the human asks or you've already run `check` green
  manually (e.g. to sidestep the binary OOM above).

### Secrets & the deployed system — do not touch without being asked
- **Never** print, commit, or bake real secrets (Ably key, Supabase
  service-role key, DB password, host secrets, access tokens). They live in
  `.env` (gitignored), Vercel env, or Supabase — not in code or the repo.
- Assume the live app (`remote.phyra.ai`), Supabase Cloud, and Ably
  are **production**. Don't run migrations, wipe data, rotate keys, or redeploy
  unless the human explicitly asks.
- `.env` and `apps/host/.openremote*` / `.openremote-live/` are local/host state —
  never commit them.

See also `AGENTS.md` (a symlink of this file) so non-Claude agents pick up the
same rules.
