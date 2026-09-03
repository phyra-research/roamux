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

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? "ws://127.0.0.1:8787"

type RelayContextValue = {
  state: RelayState
  pair: (token: string) => void
  unpair: () => void
  sendCommand: (command: RemoteCommand) => void
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

  const value = useMemo<RelayContextValue>(
    () => ({ state, pair, unpair, sendCommand }),
    [state, pair, unpair, sendCommand],
  )

  return <RelayContext.Provider value={value}>{children}</RelayContext.Provider>
}

export function useRelay(): RelayContextValue {
  const ctx = useContext(RelayContext)
  if (!ctx) throw new Error("useRelay must be used within <RelayProvider>")
  return ctx
}
