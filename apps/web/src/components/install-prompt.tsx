"use client"

import { useEffect, useState } from "react"
import { useInstallPrompt } from "./pwa-registrar"

/**
 * Small, unobtrusive "add to home screen" affordance shown above the machine
 * list. Android/Chrome gets a real button (driven by `beforeinstallprompt`);
 * iOS Safari has no such API, so it gets a one-line hint instead. Renders
 * nothing once the app is actually installed (running standalone).
 */
export function InstallPrompt() {
  const { canInstall, promptInstall } = useInstallPrompt()
  // Assume installed until the effect proves otherwise — avoids a flash of the
  // prompt during the first paint.
  const [standalone, setStandalone] = useState(true)
  const [isIos, setIsIos] = useState(false)

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean }
    setStandalone(
      window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
    )
    setIsIos(/iphone|ipad|ipod/i.test(navigator.userAgent))
  }, [])

  if (standalone) return null

  if (canInstall) {
    return (
      <button
        type="button"
        onClick={() => {
          void promptInstall()
        }}
        className="mb-3 w-full rounded-xl border border-dashed border-ink-line px-4 py-2 text-xs text-neutral-400 transition-colors hover:text-neutral-200"
      >
        Install app
      </button>
    )
  }

  if (isIos) {
    return (
      <p className="mb-3 text-center text-xs text-neutral-600">
        Tap Share → Add to Home Screen to install
      </p>
    )
  }

  return null
}
