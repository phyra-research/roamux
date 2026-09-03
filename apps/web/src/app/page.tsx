"use client"

import { AppHeader } from "@/components/app-header"
import { MachinesList } from "@/components/machines-list"
import { PairGate } from "@/components/pair-gate"
import { useRelay } from "@/lib/relay-provider"
import Link from "next/link"
import { useEffect } from "react"

export default function HomePage() {
  const { state, sendCommand } = useRelay()

  // Refresh the session list whenever we (re)connect.
  useEffect(() => {
    if (state.status === "connected") sendCommand({ type: "sessions.list" })
  }, [state.status, sendCommand])

  if (state.status !== "connected" && !state.token) {
    return (
      <>
        <AppHeader />
        <PairGate />
      </>
    )
  }

  return (
    <>
      <AppHeader />
      <main className="flex-1 px-4 py-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
          Machines
        </h2>

        <MachinesList />

        <h2 className="mb-3 mt-8 text-xs font-semibold uppercase tracking-widest text-neutral-500">
          Sessions
        </h2>
        {state.sessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-line px-4 py-8 text-center text-sm text-neutral-500">
            No sessions yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {state.sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/session/${encodeURIComponent(s.id)}`}
                  className="block rounded-xl border border-ink-line bg-ink-soft px-4 py-3 transition-colors active:bg-ink-line"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-neutral-100">{s.title}</div>
                      <div className="truncate text-xs text-neutral-500">
                        {s.model ?? "agent"}
                        {s.projectPath ? ` · ${s.projectPath}` : ""}
                      </div>
                    </div>
                    <SessionBadge status={s.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}

function SessionBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    idle: "text-neutral-500",
    running: "text-emerald-400",
    waiting: "text-amber-400",
    error: "text-red-400",
  }
  return <span className={`shrink-0 text-xs ${map[status] ?? "text-neutral-500"}`}>{status}</span>
}
