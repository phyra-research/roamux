"use client"

import { useRelay } from "@/lib/relay-provider"

/**
 * Shown inside the sticky header (#112) when the transport is down after
 * having been up — not on the initial connect, which each page's own
 * loading/skeleton state already communicates. `everConnected` lives in
 * shared relay state (relay-client.ts) rather than a local ref, so every
 * mount of this component (and anything else that cares) agrees on whether
 * this is a genuine drop vs. a first-time connect.
 *
 * Amber/warning, not accent: this is a problem state, not a live/nav
 * indicator, per the design principle — accent stays reserved for
 * interactive elements.
 */
export function ReconnectingBanner() {
  const { state } = useRelay()

  const reconnecting = state.status === "connecting" || state.status === "disconnected"
  if (!reconnecting || !state.everConnected) return null

  return (
    <div className="flex items-center justify-center gap-2 border-b border-warning/40 bg-warning/5 px-4 py-1.5 text-caption text-warning">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
      Reconnecting… your session is safe
    </div>
  )
}
