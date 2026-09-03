import { createBrowserClient } from "@supabase/ssr"

/**
 * Supabase browser client for client components (login button, sign-out).
 * Reads the public env vars — same values locally (Docker) or on Vercel (Cloud).
 * Returns null if Supabase isn't configured so the UI can degrade gracefully.
 */
export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  return createBrowserClient(url, anonKey)
}
