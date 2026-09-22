"use client"

import { Button } from "@/components/ui/button"
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
          <h1 className="text-title font-semibold text-text">Link a device</h1>
          <p className="mt-1 text-body text-text-muted">
            Enter the code shown in your terminal to connect that machine.
          </p>
        </div>

        {state === "done" ? (
          <p className="text-body text-success">{message}</p>
        ) : (
          <>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="WXYZ-1234"
              autoCapitalize="characters"
              className="w-full rounded-xl border border-paper-line bg-paper-surface px-4 py-3 text-center font-mono text-lg tracking-widest text-text outline-none focus:border-accent"
            />
            <Button
              variant="primary"
              className="w-full"
              onClick={approve}
              disabled={code.trim().length < 4}
              loading={state === "busy"}
            >
              {state === "busy" ? "Linking…" : "Approve"}
            </Button>
            {message && <p className="text-body text-error">{message}</p>}
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
