"use client"

import type { ChangedFile } from "@openremote/protocol"
import { useCallback, useEffect, useRef, useState } from "react"
import { useRelay } from "./relay-provider"

type UseDiff = {
  files: ChangedFile[]
  error: string | undefined
  /** True from a request() call until the next snapshot for this session lands. */
  loading: boolean
  /** Whether a snapshot has ever been received for this session. */
  hasLoaded: boolean
  /** Whether the relay connection is live enough to send a diff.request. */
  connected: boolean
  request: () => void
}

const NOT_CONNECTED_MSG =
  "Not connected to this machine. Open it from the home screen, then come back."

/**
 * Drives the "Changes" view for one session: sends `diff.request` over the relay
 * and reads back the `diff.snapshot` the client stashed in `state.diffs`.
 */
export function useDiff(sessionId: string): UseDiff {
  const { state, sendCommand } = useRelay()
  const entry = state.diffs[sessionId]
  const connected = state.status === "connected"
  const [loading, setLoading] = useState(false)
  // Local error for send-side failures (no connection); server-side errors ride
  // in on the snapshot itself.
  const [localError, setLocalError] = useState<string | undefined>(undefined)
  const lastAt = useRef<number | undefined>(entry?.at)

  // Clear loading once a *newer* snapshot for this session arrives.
  useEffect(() => {
    if (entry && entry.at !== lastAt.current) {
      lastAt.current = entry.at
      setLoading(false)
    }
  }, [entry])

  const request = useCallback(() => {
    if (state.status !== "connected") {
      // The command would be silently dropped by RelayClient — say so instead of
      // hanging on a spinner or showing a misleading empty state.
      setLoading(false)
      setLocalError(NOT_CONNECTED_MSG)
      return
    }
    setLocalError(undefined)
    setLoading(true)
    sendCommand({ type: "diff.request", sessionId })
  }, [sendCommand, sessionId, state.status])

  return {
    files: entry?.files ?? [],
    error: localError ?? (entry?.error ? `Couldn’t load changes: ${entry.error}` : undefined),
    loading,
    hasLoaded: entry !== undefined,
    connected,
    request,
  }
}
