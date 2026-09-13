# Security Policy

roamux gives remote devices control over agents running on your own
machines, so we take security seriously. Thank you for helping keep it safe.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, report privately via GitHub's
[private vulnerability reporting](https://github.com/phyra-research/open-remote/security/advisories/new)
("Report a vulnerability" under the repository's **Security** tab).

Please include:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept if possible),
- affected component (host daemon, web/API, protocol, transport…),
- any suggested remediation.

We'll acknowledge your report, keep you updated on the fix, and credit you
(unless you prefer to remain anonymous).

## Scope

Security-relevant areas include, but are not limited to:

- the **host daemon** (`apps/host`) and its command handling,
- the **protocol** (`packages/protocol`) — envelope validation, the command
  allowlist, channel scoping,
- **authentication and token issuance** (the web API in `apps/web`),
- the **transport** layer and cross-user isolation.

The design invariants we consider load-bearing (see
[docs/architecture.md](docs/architecture.md)):

- the agent runtime binds to **localhost only**;
- the host **dials out** — nothing local is exposed via an inbound port;
- routing is authenticated and **scoped per user** — no cross-account access;
- there is **no arbitrary remote shell**; clients send a small set of explicit,
  validated commands, never shell strings or filesystem paths;
- repos, credentials, env vars, and model keys **never cross the wire**.

A report that demonstrates a break in any of these is especially valuable.

## Handling of secrets

Never include real secrets (API keys, tokens, database credentials) in issues,
pull requests, or commits. Configuration is provided via environment variables
and is never committed to the repository.
