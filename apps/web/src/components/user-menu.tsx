"use client"

import {
  isSoundEnabled,
  requestNotificationPermissionIfNeeded,
  setSoundEnabled,
} from "@/lib/notify"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { useAuth } from "@/lib/use-auth"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

/**
 * Signed-in user chip + a dropdown with Sign out. Shows the account email so it's
 * clear WHICH account you're in (the multi-account confusion is a real trap).
 */
export function UserMenu() {
  const auth = useAuth()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Lazy init reads localStorage once on mount — avoids a hydration
  // mismatch from reading it during render on the server.
  const [soundEnabled, setSoundEnabledState] = useState(() => isSoundEnabled())
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  if (auth.loading || !auth.signedIn) return null

  async function signOut() {
    setBusy(true)
    // Sign out of Supabase if it's configured; in local dev-auth mode there's no
    // Supabase session, so we just clear and bounce to /login.
    const supabase = getSupabaseBrowserClient()
    await supabase?.auth.signOut().catch(() => {})
    router.replace("/login")
  }

  const label = auth.user?.email ?? "Account"
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="max-w-[10rem] truncate rounded-full border border-paper-line bg-paper-surface px-3 py-1 text-caption text-text"
      >
        {label}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 overflow-hidden rounded-xl border border-paper-line bg-paper-surface shadow-lg">
          <div className="truncate border-b border-paper-line px-3 py-2 text-caption text-text-muted">
            {label}
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !soundEnabled
              setSoundEnabledState(next)
              setSoundEnabled(next)
              // Only a real toggle-on click asks — never proactively on load.
              if (next) void requestNotificationPermissionIfNeeded()
            }}
            className="flex w-full items-center justify-between border-b border-paper-line px-3 py-2 text-left text-body text-text transition-colors hover:bg-accent/10"
          >
            <span>Sound alerts</span>
            <span className={soundEnabled ? "text-success" : "text-text-muted"}>
              {soundEnabled ? "On" : "Off"}
            </span>
          </button>
          <button
            type="button"
            onClick={signOut}
            disabled={busy}
            className="w-full px-3 py-2 text-left text-body text-text transition-colors hover:bg-accent/10 disabled:opacity-50"
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  )
}
