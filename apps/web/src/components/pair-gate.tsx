"use client"

import { Button } from "@/components/ui/button"
import { useRelay } from "@/lib/relay-provider"
import { useState } from "react"

/**
 * Shown until a client has paired with a host via a one-time token. On success
 * the relay associates this browser with the host holding that token.
 */
export function PairGate() {
  const { pair } = useRelay()
  const [token, setToken] = useState("")

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <h1 className="text-title font-semibold text-text">Pair a device</h1>
      <p className="mt-2 max-w-xs text-body text-text-muted">
        Run <code className="rounded bg-paper-surface px-1 py-0.5 text-text">roamux host</code> on
        your machine and paste the pairing token it prints.
      </p>
      <form
        className="mt-6 flex w-full max-w-xs flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (token.trim()) pair(token)
        }}
      >
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="pairing token"
          className="rounded-xl border border-paper-line bg-paper-surface px-4 py-3 text-center font-mono text-body tracking-widest text-text outline-none focus:border-accent"
        />
        <Button type="submit" variant="primary">
          Pair
        </Button>
      </form>
    </div>
  )
}
