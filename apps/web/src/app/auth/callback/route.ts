import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "../../../lib/supabase/server"

/**
 * GitHub OAuth callback. Supabase redirects here with a `code`; we exchange it
 * for a session (which sets the auth cookies), then send the user on to `next`
 * (default: home). The `origin` is taken from the request so it works on any
 * host — localhost or the Vercel domain — without hardcoding.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const next = url.searchParams.get("next") ?? "/"

  if (code) {
    const supabase = await getSupabaseServerClient()
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error) return NextResponse.redirect(new URL(next, url.origin))
    }
  }
  // On failure, bounce to login with an error flag.
  return NextResponse.redirect(new URL("/login?error=auth", url.origin))
}
