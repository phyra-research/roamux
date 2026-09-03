# Deploying OpenRemote

OpenRemote is **two deployables**:

- **Web + API** (`apps/web`) → **Vercel** (the internet-facing control surface).
- **Host daemon** (`apps/host`) → runs on **the user's own machine**, never deployed.
  It's obtained per-machine (run from source now; packaged binary/Homebrew later).

Everything is **env-driven** — the same code runs locally (Docker Postgres/Supabase)
or in prod (Supabase Cloud), differing only by environment variables.

---

## 1. Supabase Cloud (DB + Auth)

1. Create/open your project at https://supabase.com.
2. **Settings → API** — copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only, secret)
3. **Settings → Database → Connection string → URI** (use the **pooler / Session**
   URI for serverless) → `DATABASE_URL`
4. **Migrations**: `supabase/migrations/*.sql` apply via the Supabase GitHub
   integration on push. (Or run manually: `DATABASE_URL=… bun run db:migrate`.)
5. **Auth → Providers → GitHub** — enable, and paste the GitHub OAuth app's
   Client ID + Secret (from step 2 below).
6. **Auth → URL Configuration** — set Site URL to your Vercel domain and add
   `https://<your-domain>/auth/callback` to the redirect allow-list.

## 2. GitHub OAuth App

https://github.com/settings/developers → **New OAuth App**:

- **Homepage URL:** `https://<your-vercel-domain>`
- **Authorization callback URL:** `https://<your-project-ref>.supabase.co/auth/v1/callback`
- Copy **Client ID**, generate a **Client Secret** → paste both into Supabase
  (step 1.5 above).

## 3. Vercel (web + API)

- **Root Directory:** repo root (blank). `vercel.json` installs from root (to link
  the Bun workspace) and builds `apps/web`.
- **Environment Variables** (Settings → Environment Variables):

  | Variable | Value | Notes |
  |---|---|---|
  | `DATABASE_URL` | `postgresql://…` | Supabase pooler URI |
  | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `<anon key>` | browser-safe |
  | `SUPABASE_SERVICE_ROLE_KEY` | `<service_role key>` | **secret** |
  | `ABLY_API_KEY` | `<ably key>` | **server-only** — mints browser tokens |
  | `NEXT_PUBLIC_TRANSPORT` | `ably` | browser talks to hosts over Ably |
  | `OPENREMOTE_WEB_URL` | `https://<your-domain>` | used in the device-link URL |

  > **Do NOT set `NEXT_PUBLIC_ABLY_API_KEY`** — the browser fetches short-lived
  > scoped tokens from `/api/ably/token`; it never holds the raw key.

- Push to the deploy branch → Vercel builds and deploys.

## 4. Run a host and link it

On the machine you want to control (from source for now):

```bash
bun install
OPENREMOTE_API_URL=https://<your-domain> bun run apps/host/src/index.ts login
#   → prints a code; open https://<your-domain>/link, sign in, enter the code
TRANSPORT=ably \
ABLY_API_KEY=<same ably key> \
AGENT_ADAPTER=opencode \
DEFAULT_PROJECT_PATH=/abs/path/to/your/project \
bun run apps/host/src/index.ts
```

Then open `https://<your-domain>` on your phone → sign in → your machine appears →
New Session → pick project + agent → **Start Agent**.

## 5. Sanity checks

- `GET https://<your-domain>/api/health` → `{ ok: true, data: { status: "up" } }`
- Sign in with GitHub works and `/api/me` returns your user.
- `POST /api/ably/token` (while signed in) returns a signed token request.
