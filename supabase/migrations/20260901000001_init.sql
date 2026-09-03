-- OpenRemote control-plane schema (Beta §12.1).
-- METADATA ONLY. Never store repositories, local paths, credentials, env vars,
-- or raw agent output here — those stay host-local (Beta §12.3, §11).
--
-- Auth note: with Supabase Auth, the canonical user identity lives in
-- `auth.users`. Our `users` row references it via `auth_subject` (the Supabase
-- user id, a uuid) rather than duplicating auth state.

-- Extensions -----------------------------------------------------------------
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- Users ----------------------------------------------------------------------
create table if not exists users (
  id           uuid primary key default gen_random_uuid(),
  -- Supabase auth user id (auth.users.id). Unique so one app user per auth user.
  auth_subject uuid unique,
  email        text,
  created_at   timestamptz not null default now()
);

-- Hosts ----------------------------------------------------------------------
-- One user → many hosts. No host-count limit in the schema; quotas are an
-- application-layer entitlement (Beta §5.2, §8.4).
create table if not exists hosts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  name           text not null,
  platform       text,                         -- e.g. "darwin-arm64"
  daemon_version text,
  capabilities   jsonb not null default '{}',  -- { harnesses, supports, projects }
  status         text  not null default 'offline', -- online|offline|degraded
  last_seen_at   timestamptz,
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz                   -- set on revoke; blocks new tokens
);
create index if not exists hosts_user_id_idx on hosts(user_id);

-- Approved projects ----------------------------------------------------------
-- Display metadata only. The absolute path stays in host-local state; remote
-- clients reference project_id, never a filesystem path (Beta §13.2).
create table if not exists host_projects (
  id            uuid primary key default gen_random_uuid(),
  host_id       uuid not null references hosts(id) on delete cascade,
  display_label text not null,
  status        text not null default 'approved',
  created_at    timestamptz not null default now()
);
create index if not exists host_projects_host_id_idx on host_projects(host_id);

-- Agent sessions -------------------------------------------------------------
-- Long-lived, daemon-owned: one host + one approved project + one harness.
create table if not exists agent_sessions (
  id                  uuid primary key default gen_random_uuid(),
  host_id             uuid not null references hosts(id) on delete cascade,
  project_id          uuid references host_projects(id) on delete set null,
  harness_type        text not null,           -- "opencode" | "claude-code" | ...
  external_session_id text,                    -- the harness's own session id
  status              text not null default 'idle',
  created_at          timestamptz not null default now(),
  ended_at            timestamptz
);
create index if not exists agent_sessions_host_id_idx on agent_sessions(host_id);

-- Runs -----------------------------------------------------------------------
-- One unit of work inside a session (Beta §5.1 session/run split).
create table if not exists session_runs (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references agent_sessions(id) on delete cascade,
  status         text not null default 'active',
  result_summary text,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz
);
create index if not exists session_runs_session_id_idx on session_runs(session_id);

-- Host credentials -----------------------------------------------------------
-- A renewable secret the daemon exchanges for short-lived Ably tokens (Beta
-- §10.2). Store only a HASH, never the raw secret.
create table if not exists host_credentials (
  id              uuid primary key default gen_random_uuid(),
  host_id         uuid not null references hosts(id) on delete cascade,
  credential_hash text not null,
  issued_at       timestamptz not null default now(),
  revoked_at      timestamptz
);
create index if not exists host_credentials_host_id_idx on host_credentials(host_id);

-- Entitlements ---------------------------------------------------------------
-- Plan limits live here, NOT in the protocol (Beta §8.4).
create table if not exists entitlements (
  user_id       uuid primary key references users(id) on delete cascade,
  plan          text not null default 'beta',
  host_limit    integer,                      -- null = unlimited
  feature_flags jsonb not null default '{}'
);

-- Audit events ---------------------------------------------------------------
create table if not exists audit_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references users(id) on delete set null,
  host_id    uuid references hosts(id) on delete set null,
  session_id uuid references agent_sessions(id) on delete set null,
  event_type text not null,
  metadata   jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists audit_events_user_id_idx on audit_events(user_id);
