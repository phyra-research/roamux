"use client"

import type { RemoteCommand } from "@openremote/protocol"
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import {
  type ClientTransportConfig,
  INITIAL_STATE,
  RelayClient,
  type RelayState,
} from "./relay-client"
import type { PendingCommandKind } from "./types"

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? "ws://127.0.0.1:8787"

type RelayContextValue = {
  state: RelayState
  pair: (token: string) => void
  unpair: () => void
  sendCommand: (command: RemoteCommand) => void
  /** Optimistically-tracked send (#111) — returns the pending-command id, or
   * null if the client isn't ready yet (mirrors the other no-op-until-ready
   * callbacks below). */
  sendCommandOptimistic: (
    command: RemoteCommand,
    opts: { kind: PendingCommandKind; text?: string },
  ) => string | null
  retryCommand: (id: string) => void
  /** Connect to an account host's Ably channel (signed-in flow). */
  connectToHost: (channel: string) => void
}

const RelayContext = createContext<RelayContextValue | null>(null)

/**
 * Resolve the transport config. In Ably mode the browser authenticates via a
 * short-lived scoped token from /api/ably/token (never a raw key) and loads
 * Ably's browser build via a dynamic import — kept out of the default WS build
 * by comparing the RAW inlined env literal so webpack can dead-code-eliminate it.
 */
async function resolveConfig(): Promise<ClientTransportConfig> {
  if (process.env.NEXT_PUBLIC_TRANSPORT === "ably") {
    const { loadBrowserRealtimeCtor } = await import("@openremote/protocol/ably-browser")
    return {
      kind: "ably",
      tokenUrl: "/api/ably/token",
      realtimeCtor: await loadBrowserRealtimeCtor(),
    }
  }
  return { kind: "ws", relayUrl: RELAY_URL }
}

export function RelayProvider({ children }: { children: ReactNode }) {
  // The client is created once the transport config resolves (sync for WS, after
  // a dynamic import for Ably).
  const [client, setClient] = useState<RelayClient | null>(null)

  useEffect(() => {
    let live = true
    let created: RelayClient | null = null
    void resolveConfig().then((config) => {
      if (!live) return
      created = new RelayClient(config)
      setClient(created)
      created.connect()
    })
    return () => {
      live = false
      created?.disconnect()
    }
  }, [])

  const subscribe = useMemo(
    () => (client ? client.subscribe : (_fn: () => void) => () => {}),
    [client],
  )
  const getSnapshot = useMemo(() => (client ? client.getSnapshot : () => INITIAL_STATE), [client])
  const state = useSyncExternalStore(subscribe, getSnapshot, () => INITIAL_STATE)

  // STABLE callbacks — identity depends only on `client` (set once).
  const pair = useCallback((token: string) => client?.pair(token), [client])
  const unpair = useCallback(() => client?.unpair(), [client])
  const sendCommand = useCallback(
    (command: RemoteCommand) => client?.sendCommand(command),
    [client],
  )
  const sendCommandOptimistic = useCallback(
    (command: RemoteCommand, opts: { kind: PendingCommandKind; text?: string }) =>
      client?.sendCommandOptimistic(command, opts) ?? null,
    [client],
  )
  const retryCommand = useCallback((id: string) => client?.retryCommand(id), [client])
  const connectToHost = useCallback((channel: string) => client?.connectToHost(channel), [client])

  const value = useMemo<RelayContextValue>(
    () => ({
      state,
      pair,
      unpair,
      sendCommand,
      sendCommandOptimistic,
      retryCommand,
      connectToHost,
    }),
    [state, pair, unpair, sendCommand, sendCommandOptimistic, retryCommand, connectToHost],
  )

  return <RelayContext.Provider value={value}>{children}</RelayContext.Provider>
}

export function useRelay(): RelayContextValue {
  const ctx = useContext(RelayContext)
  if (!ctx) throw new Error("useRelay must be used within <RelayProvider>")
  return ctx
}
