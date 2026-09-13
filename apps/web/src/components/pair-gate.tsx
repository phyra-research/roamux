"use client"

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
      <h1 className="text-lg font-semibold text-neutral-100">Pair a device</h1>
      <p className="mt-2 max-w-xs text-sm text-neutral-400">
        Run <code className="rounded bg-ink-soft px-1 py-0.5 text-neutral-300">roamux host</code> on
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
          className="rounded-xl border border-ink-line bg-ink-soft px-4 py-3 text-center font-mono text-sm tracking-widest text-neutral-100 outline-none focus:border-neutral-500"
        />
        <button
          type="submit"
          className="rounded-xl bg-neutral-100 px-4 py-3 text-sm font-semibold text-ink transition-opacity active:opacity-80"
        >
          Pair
        </button>
      </form>
    </div>
  )
}
