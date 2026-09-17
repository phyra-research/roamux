"use client"

import { useRelay } from "@/lib/relay-provider"
import { useEffect, useRef } from "react"

/**
 * Shown at the top of every screen (mounted once in layout.tsx) when the
 * transport drops after having been up — not on the initial connect, which
 * each page's own loading/skeleton state already communicates. Auto-dismisses
 * by construction: it just reads live connection status each render.
 */
export function ReconnectingBanner() {
  const { state } = useRelay()
  const everConnected = useRef(false)

  useEffect(() => {
    if (state.status === "connected") everConnected.current = true
  }, [state.status])

  if (state.status !== "connecting" || !everConnected.current) return null

  return (
    <div className="flex items-center justify-center gap-2 border-b border-ink-line bg-ink-soft px-4 py-1.5 text-caption text-neutral-400">
      <span className="h-1.5 w-1.5 rounded-full bg-accent-bright animate-pulse" />
      Reconnecting…
    </div>
  )
}
