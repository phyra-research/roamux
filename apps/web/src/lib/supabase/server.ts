import { type CookieOptions, createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

type CookieToSet = { name: string; value: string; options?: CookieOptions }

/**
 * Supabase server client for route handlers / server components. Reads config
 * from env ONLY — locally these point at Docker Supabase, on Vercel at Supabase
 * Cloud; the code is identical, only the environment differs.
 *
 * Uses the ANON key + the request's auth cookies (never the service-role key on
 * a request path). Returns null when Supabase isn't configured, so callers can
 * fall back cleanly (e.g. the dev-auth escape hatch) instead of throwing.
 */
export async function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null

  const cookieStore = await cookies()
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet: CookieToSet[]) => {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // why: setAll throws in Server Components (read-only cookies); the
          // middleware/route handler path is where cookies actually get written.
        }
      },
    },
  })
}
