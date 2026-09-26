import type { AgentSession } from "@openremote/protocol"
import type { TimelineEntry } from "./types"

const SOUND_KEY = "openremote.soundEnabled"

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return true
  const raw = window.localStorage.getItem(SOUND_KEY)
  return raw === null ? true : raw === "true"
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(SOUND_KEY, String(enabled))
}

// ── session attention phase ──────────────────────────────────────────────
// Shared by the session-list display and the notify watcher so they can
// never disagree about what counts as "needs attention".

export type SessionPhase = "idle" | "waiting" | "running" | "done" | "failed"

/**
 * `AgentSession.status` alone can't distinguish "never started" from "just
 * finished" (both read as "idle") — the same ambiguity status-strip.tsx
 * already resolves by scanning the timeline for the last agent.completed/
 * agent.failed. Known limitation: a session that finished BEFORE this client
 * connected has no timeline to scan (history-replay, #109/#110, hasn't
 * landed yet) and reads as "idle" rather than "done" until something new
 * happens on it.
 */
export function deriveSessionPhase(
  status: AgentSession["status"],
  timeline: TimelineEntry[],
): SessionPhase {
  if (status === "error") return "failed"
  if (status !== "idle") return status
  const last = [...timeline]
    .reverse()
    .find((e) => e.event.type === "agent.completed" || e.event.type === "agent.failed")
  if (!last) return "idle"
  return last.event.type === "agent.failed" ? "failed" : "done"
}

// ── PWA app badge (Badging API) ──────────────────────────────────────────
// Not in TS's dom lib — extended locally via a cast, matching the existing
// house pattern for experimental Navigator members (install-prompt.tsx's
// `navigator as Navigator & { standalone?: boolean }`) rather than a global
// ambient declaration.

type NavigatorWithBadging = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

export function setAppBadge(count: number): void {
  const nav = navigator as NavigatorWithBadging
  void nav.setAppBadge?.(count).catch(() => {})
}

export function clearAppBadge(): void {
  const nav = navigator as NavigatorWithBadging
  void nav.clearAppBadge?.().catch(() => {})
}

// ── sound ─────────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null
  if (!audioCtx) audioCtx = new AudioContext()
  return audioCtx
}

/**
 * Unlocks the audio context on the first real user gesture. A freshly-
 * created AudioContext starts suspended until one occurs, and by the time we
 * actually want to play a notification sound (tab backgrounded) there's no
 * gesture available — so this has to run earlier, while the user is still
 * interacting normally.
 */
export function primeAudio(): void {
  const ctx = getAudioContext()
  if (ctx?.state === "suspended") void ctx.resume().catch(() => {})
}

function canPlaySoundPerNotificationPermission(): boolean {
  // No Notification API at all — nothing to gate sound on.
  if (typeof window === "undefined" || !("Notification" in window)) return true
  return Notification.permission === "granted"
}

/** A short, non-alarming ~200ms chirp — synthesized so this feature needs no
 * audio file asset. */
export function playNotifySound(): void {
  if (!isSoundEnabled() || !canPlaySoundPerNotificationPermission()) return
  const ctx = getAudioContext()
  if (!ctx) return
  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = "sine"
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.22)
  } catch {
    // Autoplay/browser-policy edge cases — sound is an enhancement only.
  }
}

// ── vibration ─────────────────────────────────────────────────────────────

export function vibrate(): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return
  try {
    navigator.vibrate(80)
  } catch {
    // Vibration is an enhancement only.
  }
}

// ── OS notification ──────────────────────────────────────────────────────
// Page-triggered (tab backgrounded but still alive), distinct from #114's
// server-push-when-fully-closed layer.

export async function requestNotificationPermissionIfNeeded(): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) return
  if (Notification.permission !== "default") return
  try {
    await Notification.requestPermission()
  } catch {
    // Enhancement only.
  }
}

export async function showNotification(title: string, body: string, url?: string): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) return
  if (Notification.permission !== "granted") return
  const options: NotificationOptions = {
    body,
    icon: "/icons/icon-192.png",
    tag: "roamux-attention",
    data: url ? { url } : undefined,
  }
  try {
    const reg =
      "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined
    if (reg) await reg.showNotification(title, options)
    else new Notification(title, options)
  } catch {
    // Enhancement only.
  }
}

/** Fires every "needs attention" channel at once — sound, vibration, and a
 * local notification. */
export function notifyAttentionNeeded(title: string, body: string, url?: string): void {
  playNotifySound()
  vibrate()
  void showNotification(title, body, url)
}
