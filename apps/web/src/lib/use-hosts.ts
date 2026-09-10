"use client"

import { useCallback, useEffect, useState } from "react"

/** A host as returned by GET /api/hosts (control-plane row). */
export type ApiHost = {
  id: string
  name: string
  platform: string | null
  status: "online" | "offline" | "degraded"
  lastSeenAt: string | null
  revokedAt: string | null
}

type State = { hosts: ApiHost[]; loading: boolean; error: string | null; signedIn: boolean }

/**
 * Fetch the current account's hosts from the API. Handles the "not signed in"
 * case (401) distinctly so the UI can show a sign-in prompt rather than an error.
 */
export function useHosts() {
  const [state, setState] = useState<State>({
    hosts: [],
    loading: true,
    error: null,
    signedIn: true,
  })

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/hosts")
      if (res.status === 401) {
        setState({ hosts: [], loading: false, error: null, signedIn: false })
        return
      }
      const body = await res.json()
      if (!body.ok) throw new Error(body.error ?? "failed to load hosts")
      setState({ hosts: body.data.hosts, loading: false, error: null, signedIn: true })
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const revoke = useCallback(
    async (hostId: string) => {
      await fetch(`/api/hosts/${hostId}/revoke`, { method: "POST" })
      await refresh()
    },
    [refresh],
  )

  const rename = useCallback(
    async (hostId: string, name: string) => {
      // Optimistic: show the new name immediately, then reconcile against the
      // row the API returns (or refresh to revert if the call failed).
      setState((s) => ({
        ...s,
        hosts: s.hosts.map((h) => (h.id === hostId ? { ...h, name } : h)),
      }))
      try {
        const res = await fetch(`/api/hosts/${hostId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        })
        const body = await res.json()
        if (!res.ok || !body.ok) throw new Error(body.error ?? "rename failed")
        const host = body.data.host as { name: string }
        setState((s) => ({
          ...s,
          hosts: s.hosts.map((h) => (h.id === hostId ? { ...h, name: host.name } : h)),
        }))
      } catch {
        await refresh()
      }
    },
    [refresh],
  )

  return { ...state, refresh, revoke, rename }
}
