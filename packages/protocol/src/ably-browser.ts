import type { RealtimeCtor } from "./ably-transport.js"

/**
 * Browser `Realtime` constructor loaded from Ably's CDN at runtime.
 *
 * Ably's prebuilt bundles use a `super(...args)` class-expression that webpack
 * (Next's bundler) cannot parse ("super outside method"), which breaks
 * `next build`. Rather than fight the bundler, we load Ably's official browser
 * UMD from its CDN on demand — the supported browser-usage path — and read the
 * `Ably.Realtime` global. This keeps Ably out of the webpack graph entirely, so
 * the app builds cleanly and Ably is only fetched when Ably mode is actually used.
 */

const CDN_URL = "https://cdn.ably.com/lib/ably.min-2.js"

declare global {
  interface Window {
    Ably?: { Realtime: RealtimeCtor }
  }
}

let loading: Promise<RealtimeCtor> | null = null

export function loadBrowserRealtimeCtor(): Promise<RealtimeCtor> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Ably browser client can only load in a browser"))
  }
  if (window.Ably?.Realtime) return Promise.resolve(window.Ably.Realtime)
  if (loading) return loading

  loading = new Promise<RealtimeCtor>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CDN_URL}"]`)
    const onReady = () => {
      if (window.Ably?.Realtime) resolve(window.Ably.Realtime)
      else reject(new Error("Ably loaded but Realtime is missing"))
    }
    if (existing) {
      existing.addEventListener("load", onReady)
      existing.addEventListener("error", () => reject(new Error("failed to load Ably from CDN")))
      return
    }
    const script = document.createElement("script")
    script.src = CDN_URL
    script.async = true
    script.addEventListener("load", onReady)
    script.addEventListener("error", () => reject(new Error("failed to load Ably from CDN")))
    document.head.appendChild(script)
  })
  return loading
}
