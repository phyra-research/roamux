"use client"

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
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">OpenRemote</h1>
          <p className="mt-1 text-sm text-neutral-500">Control your agents from anywhere.</p>
        </div>

        {configured ? (
          <button
            type="button"
            onClick={signIn}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-ink-line bg-ink-soft px-4 py-3 text-sm font-medium text-neutral-100 transition-colors active:bg-ink-line disabled:opacity-50"
          >
            {busy ? "Redirecting…" : "Sign in with GitHub"}
          </button>
        ) : (
          <div className="rounded-xl border border-dashed border-ink-line px-4 py-6 text-sm text-neutral-500">
            Auth isn’t configured yet. Set{" "}
            <code className="text-neutral-400">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="text-neutral-400">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
          </div>
        )}

        {err && <p className="text-sm text-red-400">{err}</p>}
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
