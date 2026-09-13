/**
 * roamux service worker — minimal app-shell cache for installability.
 *
 * SECURITY (CLAUDE.md §3): authenticated traffic is NEVER intercepted or
 * cached. Any /api/* or /auth/* request, and anything carrying an
 * Authorization header, bypasses the worker entirely and hits the network —
 * we must never serve a stale authenticated response.
 *
 * Bump the version to invalidate every prior cache on the next activate.
 */
const CACHE = "openremote-shell-v2"

// Same-origin static shell to pre-cache. Everything else (routes, _next/static)
// is cached lazily on first fetch.
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"]

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)
  const sameOrigin = url.origin === self.location.origin

  // Never touch auth-bearing or API/auth traffic — never serve stale auth.
  if (sameOrigin && (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/"))) return
  if (request.headers.has("authorization")) return

  // The manifest is precached for offline install, but served network-first: a
  // cache-first manifest masks every future edit until the cache version bumps.
  // Fall back to the cached copy only when offline.
  if (sameOrigin && url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)))
          return res
        })
        .catch(() => caches.match(request).then((hit) => hit ?? Response.error())),
    )
    return
  }

  // Cache-first ONLY for our own static shell; else fall through to the network
  // with no service-worker caching.
  const isShell =
    sameOrigin && (SHELL.includes(url.pathname) || url.pathname.startsWith("/_next/static/"))
  if (!isShell) return

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit
      return fetch(request).then((res) => {
        const copy = res.clone()
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)))
        return res
      })
    }),
  )
})
