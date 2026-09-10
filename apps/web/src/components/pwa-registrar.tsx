"use client"

import { useCallback, useEffect, useSyncExternalStore } from "react"

/**
 * PWA wiring. Registers the service worker (production only — a stale SW cache
 * makes local iteration miserable) and captures the `beforeinstallprompt` event
 * so the UI can offer an in-app "Install app" button on Android/Chrome.
 * Rendered once, at the layout level.
 */

// Not in the DOM lib yet — describe only what we use.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

// Module-level so the affordance works regardless of mount order: the browser
// fires `beforeinstallprompt` once, early, and we hold onto it.
let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function setDeferred(event: BeforeInstallPromptEvent | null) {
  deferred = event
  for (const notify of listeners) notify()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

let wired = false
function wireOnce() {
  if (wired || typeof window === "undefined") return
  wired = true
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault() // keep the browser's mini-infobar from showing
    setDeferred(event as BeforeInstallPromptEvent)
  })
  window.addEventListener("appinstalled", () => setDeferred(null))
}

/** Whether an in-app install button can be shown, plus the trigger for it. */
export function useInstallPrompt(): { canInstall: boolean; promptInstall: () => Promise<void> } {
  const canInstall = useSyncExternalStore(
    subscribe,
    () => deferred !== null,
    () => false,
  )
  const promptInstall = useCallback(async () => {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    setDeferred(null) // the prompt is single-use
  }, [])
  return { canInstall, promptInstall }
}

export function PwaRegistrar() {
  useEffect(() => {
    wireOnce()
    if (process.env.NODE_ENV !== "production") return
    if (!("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // why: SW registration is progressive enhancement — a failure here must
      // never break the app.
    })
  }, [])
  return null
}
