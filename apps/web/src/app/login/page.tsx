"use client"

import { Button } from "@/components/ui/button"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"

function LoginInner() {
  const params = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(params.get("error") ? "Sign-in failed." : null)
  const configured =
    typeof process.env.NEXT_PUBLIC_SUPABASE_URL === "string" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL.length > 0

  async function signIn() {
    setErr(null)
    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      setErr("Auth is not configured.")
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      // Redirect back through our callback on whatever origin we're served from.
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      setErr(error.message)
      setBusy(false)
    }
    // On success the browser is redirected to GitHub; nothing else to do.
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="relative">
          {/* Signature brand moment for the first-impression screen — a soft
              accent glow behind the wordmark, decorative only. */}
          <div
            aria-hidden
            className="-top-16 -translate-x-1/2 pointer-events-none absolute left-1/2 h-40 w-40 rounded-full bg-accent/10 blur-3xl"
          />
          <h1 className="relative text-display font-semibold text-text">roamux</h1>
          <a
            href="https://phyra.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="relative mt-0.5 inline-block text-caption text-text-muted transition-colors hover:text-text"
          >
            by Phyra Research
          </a>
          <p className="relative mt-1 text-body text-text-muted">
            Control your agents from anywhere.
          </p>
        </div>

        {configured ? (
          <Button variant="primary" className="w-full" onClick={signIn} loading={busy}>
            {busy ? "Redirecting…" : "Sign in with GitHub"}
          </Button>
        ) : (
          <div className="rounded-xl border border-dashed border-paper-line px-4 py-6 text-body text-text-muted">
            Auth isn’t configured yet. Set{" "}
            <code className="text-text">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="text-text">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
          </div>
        )}

        {err && <p className="text-body text-error">{err}</p>}
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  )
}
