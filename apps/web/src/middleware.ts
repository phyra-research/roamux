import { type CookieOptions, createServerClient } from "@supabase/ssr"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

type CookieToSet = { name: string; value: string; options?: CookieOptions }

/**
 * Refresh the Supabase auth session on every request so server components and
 * route handlers see a valid token. No-op when Supabase env isn't set (local
 * dev without auth). Standard Supabase-SSR middleware pattern, env-driven so it
 * behaves identically locally and on Vercel.
 */
export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  let res = NextResponse.next({ request: req })
  if (!url || !anonKey) return res

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (toSet: CookieToSet[]) => {
        for (const { name, value } of toSet) req.cookies.set(name, value)
        res = NextResponse.next({ request: req })
        for (const { name, value, options } of toSet) res.cookies.set(name, value, options)
      },
    },
  })

  // Touch the user to trigger a token refresh if needed.
  await supabase.auth.getUser()
  return res
}

export const config = {
  // Run on everything except static assets and the auth callback.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
