# CLAUDE.md — Working agreement for OpenRemote

This file is the contract for **every** contributor to this repo, human or AI
coding agent (Claude Code, OpenCode, Cursor, Aider, …). Read it before you
touch code. If you are an agent, treat this as a hard constraint, not advice.

---

## 1. What OpenRemote is

OpenRemote is a **remote control plane for local AI coding agents**.

The user's machine stays the execution host — the agent, repo, shell,
filesystem, credentials, git state, MCP servers and model access all live there.
A phone or remote browser can watch and steer that agent through a relay.

```
Phone / Browser ──ws──▶ Relay ──ws──▶ Host Daemon ──localhost──▶ OpenCode ──▶ model
```

For V0 the local agent runtime is **OpenCode**. We do **not** implement our own
coding agent.

## 2. The one boundary that must never blur

```
OpenRemote protocol  ⇕  AgentAdapter  ⇕  OpenCode
```

- All host ↔ relay ↔ client traffic is **versioned protocol messages** validated
  with Zod (`packages/protocol`). Never send raw internal objects over a socket.
- The host talks to a runtime **only** through the `AgentAdapter` interface
  (`packages/agent-adapters`). OpenCode-specific code lives **only** inside
  `OpenCodeAdapter`. If you find yourself importing `@opencode-ai/sdk` outside
  that file, stop — you are leaking the abstraction.

Everything else is allowed to be small, dumb, and replaceable. This boundary is
not.

## 3. Security invariants (do not violate, ever)

1. OpenCode listens on **localhost only**. Never bind it to a public interface.
2. The **host initiates the outbound** connection to the relay. The relay never
   dials the host, never touches the filesystem, repo, shell, or credentials.
3. The relay routes messages between an **authenticated** client and its paired
   host. No auth ⇒ no routing.
4. Never send shell credentials, env vars, or secrets over the wire to the relay.
5. No arbitrary remote terminal / arbitrary code execution surface. Only the
   explicit protocol commands are honored.
6. Device IDs and pairing tokens are random. Treat pairing tokens as secrets.

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
vertical slice, run it, watch events flow, then generalize. The single exception
is the protocol/adapter boundary in §2 — that we design up front.

## 5. Milestones (build in order — do not skip ahead)

- **M1 — Vertical slice:** browser → relay → host → OpenCode and events back;
  remote stop works. Prove it with `MockAgentAdapter` first, then real OpenCode.
- **M2 — Permissions:** `permission.requested` reaches the browser; allow/deny
  flows back and the agent resumes.
- **M3 — Hardening:** reconnection, event sequence resume, session history, git
  diff view, QR pairing, PWA, push on permission.

Do not start M3 until M1 and M2 work.

## 6. Repo layout

```
apps/
  host/    long-running daemon on the user's machine (adapter host)
  relay/   stateless-ish ws router (Bun.serve)
  web/     Next.js mobile-first control surface
packages/
  protocol/        Zod-validated envelopes, commands, events, sequencing
  agent-adapters/  AgentAdapter interface + MockAgentAdapter + OpenCodeAdapter
scripts/   dev orchestration
docs/      architecture.md — components, boundaries, protocol, flow diagrams
```

Full architecture with diagrams: [`docs/architecture.md`](docs/architecture.md).

## 7. House style

- **TypeScript everywhere**, strict. No `any` without a `// why:` comment.
- Runtime & package manager: **Bun**. `bun install`, `bun test`, `bun run dev`.
- Formatting & linting: **Biome**. Double quotes, no semicolons, trailing commas.
- Validation: **Zod**. Parse at every trust boundary (socket in, config in).
- Naming: `kebab-case` files, `PascalCase` types, `camelCase` values.
- Keep functions short. Keep modules single-purpose. Comment the *why*, not the *what*.

## 8. Definition of done — run before every commit / handoff

```bash
bun run check      # typecheck + biome + tests, all must pass
```

`bun run check` is also enforced by `scripts/check.ts` and the git pre-commit
hook (`.githooks/pre-commit`, enabled via `git config core.hooksPath .githooks`).
A change is not "done" until:

1. `bun run check` is green.
2. New behavior has a test (protocol → serialization test; adapter/handler →
   unit test with `MockAgentAdapter`, never a live model).
3. The security invariants in §3 still hold.
4. Docs updated if you changed how to run or configure anything.

## 9. For AI agents specifically

- Prefer editing existing files over adding new ones. Match surrounding style.
- Never commit or push unless the human asks.
- If a task pushes you to break §2 or §3, do **not** do it silently — surface the
  conflict and propose an alternative.
- Tests must never depend on a real model, network, or a specific machine.
  Use `MockAgentAdapter`.
- Leave the repo in a working state (`bun run check` green) at the end of a task.

See also `AGENTS.md` (symlink of this file) so non-Claude agents pick up the
same rules.
