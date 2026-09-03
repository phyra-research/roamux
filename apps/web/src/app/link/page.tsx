"use client"

import { useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"

function LinkInner() {
  const params = useSearchParams()
  const [code, setCode] = useState(params.get("code") ?? "")
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle")
  const [message, setMessage] = useState<string | null>(null)

  async function approve() {
    setState("busy")
    setMessage(null)
    const res = await fetch("/api/device/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userCode: code.trim() }),
    })
    const body = await res.json().catch(() => null)
    if (res.status === 401) {
      setState("error")
      setMessage("Please sign in first, then try again.")
    } else if (res.ok && body?.ok) {
      setState("done")
      setMessage(`Linked "${body.data.host.name}" to your account. You can close this tab.`)
    } else {
      setState("error")
      setMessage(body?.error ?? "That code isn’t valid or has expired.")
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Link a device</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Enter the code shown in your terminal to connect that machine.
          </p>
        </div>

        {state === "done" ? (
          <p className="text-sm text-emerald-400">{message}</p>
        ) : (
          <>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="WXYZ-1234"
              autoCapitalize="characters"
              className="w-full rounded-xl border border-ink-line bg-ink-soft px-4 py-3 text-center font-mono text-lg tracking-widest text-neutral-100 outline-none focus:border-neutral-500"
            />
            <button
              type="button"
              onClick={approve}
              disabled={state === "busy" || code.trim().length < 4}
              className="w-full rounded-xl border border-ink-line bg-ink-soft px-4 py-3 text-sm font-medium text-neutral-100 transition-colors active:bg-ink-line disabled:opacity-50"
            >
              {state === "busy" ? "Linking…" : "Approve"}
            </button>
            {message && <p className="text-sm text-red-400">{message}</p>}
          </>
        )}
      </div>
    </main>
  )
}

export default function LinkPage() {
  return (
    <Suspense fallback={null}>
      <LinkInner />
    </Suspense>
  )
}
