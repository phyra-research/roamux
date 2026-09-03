-- Device-authorization grant for `openremote login` (Beta §10.2).
-- A host with no browser gets a short user_code; the user approves it from a
-- logged-in browser, binding the pending device to their account and minting a
-- host credential the daemon then stores.

create table if not exists device_auth (
  id           uuid primary key default gen_random_uuid(),
  -- Opaque secret the daemon polls with (never shown to the user).
  device_code  text unique not null,
  -- Short human-typable code the user enters in the browser (e.g. WXYZ-1234).
  user_code    text unique not null,
  -- Requested host display name (from the daemon at start).
  host_name    text not null,
  platform     text,
  -- pending → approved → consumed  (or expired via expires_at)
  status       text not null default 'pending',
  -- Set on approval: which user approved + which host was created.
  user_id      uuid references users(id) on delete cascade,
  host_id      uuid references hosts(id) on delete set null,
  -- The host credential (raw) returned to the daemon exactly once on poll.
  host_secret  text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '10 minutes')
);
create index if not exists device_auth_user_code_idx on device_auth(user_code);
