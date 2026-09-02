"use client"

import type { RemoteCommand } from "@openremote/protocol"
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react"
import { type ClientTransportConfig, RelayClient, type RelayState } from "./relay-client"

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? "ws://127.0.0.1:8787"
const TRANSPORT = process.env.NEXT_PUBLIC_TRANSPORT ?? "ws"
const ABLY_API_KEY = process.env.NEXT_PUBLIC_ABLY_API_KEY ?? ""

// Choose the client transport at build/runtime. Ably needs a browser-usable key
// (Phase 1 dev). Phase 2 swaps this for a short-lived token from the API.
const TRANSPORT_CONFIG: ClientTransportConfig =
  TRANSPORT === "ably"
    ? { kind: "ably", apiKey: ABLY_API_KEY }
    : { kind: "ws", relayUrl: RELAY_URL }

type RelayContextValue = {
  state: RelayState
  pair: (token: string) => void
  unpair: () => void
  sendCommand: (command: RemoteCommand) => void
}

const RelayContext = createContext<RelayContextValue | null>(null)

export function RelayProvider({ children }: { children: ReactNode }) {
  // One client instance for the whole app lifetime.
  const client = useMemo(() => new RelayClient(TRANSPORT_CONFIG), [])

  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot)

  useEffect(() => {
    client.connect()
    return () => client.disconnect()
  }, [client])

  // STABLE callbacks — identity never changes across renders. This matters:
  // pages call sendCommand inside effects keyed on [status, sendCommand]; if the
  // identity churned on every state update, those effects would re-fire in an
  // infinite loop (send → state change → new fn → send → …).
  const pair = useCallback((token: string) => client.pair(token), [client])
  const unpair = useCallback(() => client.unpair(), [client])
  const sendCommand = useCallback((command: RemoteCommand) => client.sendCommand(command), [client])

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
