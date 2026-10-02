# Remote MCP + auth — design (PR #2)

Goal: connect **Claude mobile / ChatGPT** (any remote MCP client) to roamux so a
user can drive their hosts from their phone. This is the SAME tool surface as the
stdio v1 (`apps/mcp`), behind an HTTP transport and real auth.

## The core problem

The stdio server trusts its environment (shared Ably key, local process). A
remote server cannot: it faces the public internet and must answer "**which
roamux user is this request, and may it reach that user's hosts only?**" — with
cross-user isolation (CLAUDE.md §3) intact.

roamux's existing web auth is **cookie-based Supabase sessions** (`requireUser` →
`supabase.auth.getUser()` from the auth cookie). An MCP client has **no such
cookie** — MCP's remote-auth model is **OAuth 2.1**: the client obtains a token,
then sends it as `Authorization: Bearer <token>` on every MCP request.

So PR #2 must bridge: **MCP OAuth → a roamux user → that user's scoped Ably
token → the existing tools.**

## Chosen approach: roamux as a thin OAuth layer that DELEGATES login to Supabase

We do **not** build a full identity provider. roamux already has identity
(Supabase/GitHub). The MCP auth layer is a thin bridge:

```
Claude (MCP client)
  │  1. Dynamic Client Registration (RFC 7591)  ─▶  /api/mcp/oauth/register
  │  2. Authorize (PKCE)                         ─▶  /api/mcp/oauth/authorize
  │       └─ roamux redirects the USER to Supabase/GitHub login (existing flow)
  │       └─ on return, roamux has a Supabase session → knows the roamux user
  │       └─ roamux issues an auth CODE bound to that user + PKCE challenge
  │  3. Token exchange (code + PKCE verifier)    ─▶  /api/mcp/oauth/token
  │       └─ roamux returns an ACCESS TOKEN (roamux-signed JWT, user-scoped)
  ▼
Claude calls MCP tools with  Authorization: Bearer <access token>
  │                                             ─▶  /api/mcp   (Streamable HTTP)
  │   route validates the token → resolves roamux userId
  │   → mints a scoped Ably TokenRequest (reuse createScopedTokenRequest)
  │   → runs the SAME tools from apps/mcp against that user's channels
  ▼
Ably (per-user scope)  ─▶  host  ─▶  agent
```

### Why delegate (not a full IdP)

- Reuses the login users already have (GitHub via Supabase). No new credentials.
- The sensitive mapping — "this token = this roamux user" — is issued by roamux
  AFTER a verified Supabase session, so it inherits Supabase's identity guarantees.
- The Ably scoping (`openremote:user:{userId}:*`) is **already** implemented in
  `createScopedTokenRequest` — we reuse it verbatim. Cross-user isolation is
  unchanged.

## Endpoints (new, under `apps/web/src/app/api/mcp/`)

| Route | Purpose |
| --- | --- |
| `/.well-known/oauth-authorization-server` | OAuth metadata (RFC 8414) so clients auto-discover endpoints |
| `/api/mcp/oauth/register` | Dynamic Client Registration (RFC 7591) |
| `/api/mcp/oauth/authorize` | Start auth; delegate to Supabase login; issue PKCE-bound code |
| `/api/mcp/oauth/token` | Exchange code (+ PKCE verifier) → roamux access token |
| `/api/mcp` | The Streamable HTTP MCP endpoint; Bearer-authed; runs the tools |

## Token model

- **Access token**: a short-lived JWT **signed by roamux** (new secret
  `MCP_TOKEN_SECRET`), claims: `sub` = roamux userId, `exp`, `aud=roamux-mcp`.
  Validated on every `/api/mcp` call → gives us the userId with no DB hit.
- **No Ably key ever reaches the client.** The `/api/mcp` route mints a
  short-lived scoped Ably TokenRequest per request (or per session), exactly like
  the browser path. The MCP client only ever holds the roamux access token.
- Auth codes + registered clients: stored in Postgres (metadata only), short TTL.

## Reuse (no reinvention)

- `createScopedTokenRequest(clientId, capability)` — the Ably scoping, as-is.
- `upsertUserByAuthSubject` / Supabase session — the identity, as-is.
- `RoamuxClient` + `TOOLS` from `apps/mcp` — the tool surface, **verbatim**. The
  only new thing is a transport factory that uses the scoped token
  (`authCallback`) instead of the raw key — `AblyTransport` already supports this.

## Security invariants (must hold)

- One token → exactly one user; tools can reach only that user's Ably scope.
- No Ably key / Supabase service key to the client — ever.
- The tool surface stays the closed `RemoteCommand` set — no new capability.
- `respond_permission` is exposed (product decision); the human still sees every
  request via push (#114) + web UI. (A per-user "autonomous approvals" opt-in is
  a sensible follow-up, not required for this PR.)

## What YOU (infra) own at deploy time

1. **Set `MCP_TOKEN_SECRET`** (and any OAuth signing config) in Vercel env.
2. **Supabase redirect URLs**: allow the roamux `/api/mcp/oauth/authorize`
   callback so the delegated login returns correctly.
3. **Register/publish the MCP server URL** (`https://remote.phyra.ai/api/mcp`) and
   add it as a connector in Claude (mobile/desktop).
4. Confirm the DB migration for oauth codes/clients is applied (Supabase).

## Scope boundary for PR #2

- In: the 5 routes above, token issue/verify, the HTTP MCP endpoint reusing the
  tools, a DB migration for oauth state, tests (token verify + tool wiring with a
  mock transport), docs.
- Out (follow-ups): autonomous-approvals toggle, host-discovery nicety, #109
  history backing for `get_activity`.

## Honest caveat

The OAuth round-trip can only be fully verified against a live deploy (real
redirect URLs + env). The PR will be structurally complete and `bun run check`
green, with unit tests for the token + tool layers — but the end-to-end
phone→host flow is confirmed only after the deploy steps above.
