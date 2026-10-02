-- MCP remote-auth (OAuth 2.1) state for the roamux MCP server.
-- roamux acts as a thin OAuth authorization server that DELEGATES login to
-- Supabase: any compliant MCP client (Claude, ChatGPT, …) registers, runs the
-- PKCE authorize flow (the user logs in via the existing Supabase session), and
-- exchanges a one-time code for a roamux-signed access token. Only metadata is
-- stored here — never Ably keys or file content.

-- Dynamically-registered OAuth clients (RFC 7591). Clients self-register their
-- redirect URIs; we hand back a client_id (public clients use PKCE, no secret).
create table if not exists oauth_clients (
  id             uuid primary key default gen_random_uuid(),
  client_id      text unique not null,
  client_name    text,
  -- JSON array of allowed redirect URIs the client registered.
  redirect_uris  jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists oauth_clients_client_id_idx on oauth_clients(client_id);

-- One-time authorization codes (OAuth 2.1 + PKCE). Issued after the user has a
-- verified Supabase session, bound to the user + the client's PKCE challenge.
-- Exchanged exactly once at the token endpoint, then marked consumed.
create table if not exists oauth_codes (
  id                     uuid primary key default gen_random_uuid(),
  code                   text unique not null,
  client_id              text not null,
  user_id                uuid not null references users(id) on delete cascade,
  redirect_uri           text not null,
  -- PKCE (RFC 7636): the client sends a challenge now, the verifier at exchange.
  code_challenge         text not null,
  code_challenge_method  text not null default 'S256',
  -- Opaque value the client round-trips to defend against CSRF.
  state                  text,
  consumed               boolean not null default false,
  created_at             timestamptz not null default now(),
  expires_at             timestamptz not null default (now() + interval '5 minutes')
);
create index if not exists oauth_codes_code_idx on oauth_codes(code);
