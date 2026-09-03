"use client"

import { useEffect, useState } from "react"

type AuthState = {
  loading: boolean
  signedIn: boolean
  user: { id: string; email: string | null } | null
}

/**
 * Resolve the current signed-in user from /api/me. Drives the home-page auth
 * gate: unauthenticated visitors are sent to /login; signed-in users see their
 * account's machines.
 */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ loading: true, signedIn: false, user: null })

  useEffect(() => {
    let live = true
    fetch("/api/me")
      .then(async (res) => {
        if (!live) return
        if (res.status === 401) {
          setState({ loading: false, signedIn: false, user: null })
          return
        }
        const body = await res.json()
        setState({ loading: false, signedIn: !!body.ok, user: body.data?.user ?? null })
      })
      .catch(() => {
        if (live) setState({ loading: false, signedIn: false, user: null })
      })
    return () => {
      live = false
    }
  }, [])

  return state
}
