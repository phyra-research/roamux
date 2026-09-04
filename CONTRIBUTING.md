# Contributing to OpenRemote

Welcome! This is the **local development guide** for human contributors. For the
architecture and the rules every contributor (human or AI) must follow, read
[`CLAUDE.md`](CLAUDE.md) — it's the contract. This file gets you *running*.

TL;DR — the fastest way to a running app, no cloud accounts needed:

```sh
bun install
bun run dev        # relay + host (mock agent) + web at http://localhost:3000
```

---

## 1. Prerequisites

| Tool | Why | Install |
|---|---|---|
| **Bun** ≥ 1.4 | runtime, package manager, test runner | `curl -fsSL https://bun.sh/install \| bash` |
| **Docker** | local Postgres (only for the DB/API/auth path) | Docker Desktop |
| **OpenCode** | the agent runtime (only for the real-agent path) | `curl -fsSL https://opencode.ai/install \| bash`, then `opencode auth login` |

Node is **not** required. Everything runs on Bun.

## 2. Clone & install

```sh
git clone https://github.com/phyra-research/open-remote.git
cd open-remote
bun install

# Enable the pre-commit hook (runs `bun run check` before every commit):
git config core.hooksPath .githooks

cp .env.example .env    # sensible local defaults; edit only if you need cloud paths
```

## 3. Run it locally (three levels)

The app has independent layers; pick the level you need. **You do NOT need any
cloud accounts (Supabase/Ably/Vercel) to develop most things.**

### Level A — the vertical slice with a fake agent (no cloud, no OpenCode)

```sh
bun run dev
```

Starts the **relay + host (mock adapter) + web** together, prefixed logs. Then:

1. Open **http://localhost:3000**.
2. The host prints a **pairing token** — paste it in the UI (or open the printed
   `…/pair?token=…` link).
3. You get a scripted agent run — proves the whole pipe (browser → relay → host
   → agent → back) with no model or key.

Run pieces separately if you prefer:
`bun run dev:relay` · `bun run dev:host` · `bun run dev:web`.

### Level B — a real agent (OpenCode + a model)

Needs OpenCode installed and a model configured (`opencode auth login`). Run the
host with the OpenCode adapter (relay + web from Level A still apply):

```sh
AGENT_ADAPTER=opencode DEFAULT_PROJECT_PATH=/abs/path/to/a/project bun run dev:host
```

The host spawns `opencode serve` on `127.0.0.1` and drives a real model. A failed
model call surfaces as **✗ Agent failed: …** (not a silent hang).

### Level C — accounts, DB & API (Supabase-shaped, but all local)

For work on auth, the API routes, host registry, or device-login — run against a
**local Postgres** (no Supabase Cloud needed):

```sh
bun run db:up        # start a Postgres 16 container on :5432
bun run db:migrate   # apply supabase/migrations/* to it
```

Then run the web app with the local DB and a **dev-auth bypass** (so you don't
need real GitHub OAuth locally):

```sh
# in apps/web, or export these in your shell:
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/openremote \
OPENREMOTE_DEV_AUTH_SUBJECT=$(uuidgen) \
bun run dev:web
```

- `OPENREMOTE_DEV_AUTH_SUBJECT` (a uuid) makes the API treat you as a fixed
  signed-in user **only when Supabase env is unset** — never in prod.
- Hit the API: `GET /api/health`, `GET /api/hosts`, `POST /api/hosts`, etc.
- To test **real** Supabase Auth (GitHub OAuth) locally, bring up the full
  Supabase stack (`supabase start`) and set `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See [`DEPLOY.md`](DEPLOY.md) for the shape.

> **Env is everything.** The same code runs locally or in prod, differing only by
> environment variables — see [`.env.example`](.env.example) for the full list.
> The prod stack (Vercel + Supabase Cloud + Ably) and how to deploy is in
> [`DEPLOY.md`](DEPLOY.md).

## 4. Tests

```sh
bun test                 # all unit + integration tests (fast, no DB)
bun run db:test          # DB integration tests (needs `db:up` + `db:migrate` first)
```

- Tests must **never** depend on a real model, network, or a specific machine —
  use `MockAgentAdapter`.
- DB tests are **opt-in** behind `RUN_DB_TESTS=1` (skipped by default) so a fresh
  clone stays green without Postgres.

## 5. Definition of done — before you push a PR

```sh
bun run check      # typecheck + Biome lint + tests — must be green
```

Also, if you touched the web app, make sure `next build` still passes (it's the
deploy gate). A change isn't done until:

1. `bun run check` is green.
2. New behavior has a test.
3. The security invariants in [`CLAUDE.md`](CLAUDE.md) §3 still hold.
4. Docs updated if you changed how to run/configure/deploy anything.

## 6. Repo map (where things live)

```
apps/host    the daemon + `openremote` CLI (login/host). Runs on the user's machine.
apps/relay   local-dev WebSocket router. NOT used in prod (Ably replaces it).
apps/web     Next.js UI + API (app/api/*) + Supabase auth. Deploys to Vercel.
packages/protocol        Zod envelopes, commands/events, Transport (WS + Ably), channels.
packages/agent-adapters  HarnessAdapter + MockAgentAdapter + OpenCodeAdapter.
packages/db              Postgres schema, migration runner, typed repos.
supabase/migrations      control-plane SQL (single source; local + prod).
scripts/                 dev orchestration, check.ts, build-cli.ts.
docs/                    architecture.md (V0) + beta-architecture.md (live design).
```

## 7. Working style & PRs

- **TypeScript strict**, **Bun**, **Biome** (double quotes, no semicolons, trailing
  commas), **Zod** at every trust boundary. Full house style in `CLAUDE.md` §7.
- Branch off `main`; open a PR; keep it green (`bun run check`).
- Match the surrounding code; comment the *why*, not the *what*.
- Don't commit the large `apps/web/public/cli/*` binaries in unrelated PRs — they
  bloat the diff (and can OOM the commit). See issue #44 (moving them off git).
- Never weaken a security invariant (`CLAUDE.md` §3) silently — flag it in the PR.

Questions or a gnarly area? The architecture docs (`docs/`) and the issue tracker
(the `beta` / `phase:*` / `hardening` labels) are the map.
