"use client"

import {
  type SessionPhase,
  clearAppBadge,
  deriveSessionPhase,
  notifyAttentionNeeded,
  primeAudio,
  setAppBadge,
} from "@/lib/notify"
import { useRelay } from "@/lib/relay-provider"
import { useEffect, useRef } from "react"

const ATTENTION_PHASES: ReadonlySet<SessionPhase> = new Set(["waiting", "done", "failed"])

function attentionMessage(phase: SessionPhase): string | null {
  if (phase === "waiting") return "Waiting for your input"
  if (phase === "done") return "Run completed"
  if (phase === "failed") return "Run failed"
  return null
}

/**
 * Global watcher (#113): observes every session on the currently-connected
 * host for "needs attention" state and — only while the tab is backgrounded —
 * updates the PWA app badge and fires sound/vibration/notification. Mounted
 * once at the layout level (not per-session-page) so it works regardless of
 * which page is open, not just the specific session that changed.
 */
export function NotifyWatcher() {
  const { state } = useRelay()
  // What we last observed per session, kept in sync whenever the tab is
  // visible — so re-hiding always starts edge-detection from "what's true
  // right now" instead of replaying something already seen and dismissed.
  const lastSeenRef = useRef<Map<string, SessionPhase>>(new Map())

  // Unlock audio on the first real user gesture — by the time we actually
  // want to play a sound (tab backgrounded) there's no gesture available.
  useEffect(() => {
    const prime = () => primeAudio()
    document.addEventListener("pointerdown", prime, { once: true })
    return () => document.removeEventListener("pointerdown", prime)
  }, [])

  // Badge: a live count, recomputed on every relevant change and on
  // visibility change — not accumulated, so it always reflects reality.
  useEffect(() => {
    const updateBadge = () => {
      if (document.visibilityState !== "hidden") {
        clearAppBadge()
        return
      }
      const count = state.sessions.filter((s) =>
        ATTENTION_PHASES.has(deriveSessionPhase(s.status, state.timelines[s.id] ?? [])),
      ).length
      if (count > 0) setAppBadge(count)
      else clearAppBadge()
    }
    updateBadge()
    document.addEventListener("visibilitychange", updateBadge)
    return () => document.removeEventListener("visibilitychange", updateBadge)
  }, [state.sessions, state.timelines])

  // Sound/vibration/notification: edge-triggered, once per transition,
  // never while the tab is visible (the user is already looking).
  useEffect(() => {
    const hidden = document.visibilityState === "hidden"
    for (const s of state.sessions) {
      const phase = deriveSessionPhase(s.status, state.timelines[s.id] ?? [])
      const prev = lastSeenRef.current.get(s.id)
      lastSeenRef.current.set(s.id, phase)
      if (!hidden || phase === prev) continue
      const message = attentionMessage(phase)
      if (message) notifyAttentionNeeded(s.title, message, `/session/${encodeURIComponent(s.id)}`)
    }
  }, [state.sessions, state.timelines])

  return null
}
