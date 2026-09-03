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

  return { ...state, refresh, revoke }
}
