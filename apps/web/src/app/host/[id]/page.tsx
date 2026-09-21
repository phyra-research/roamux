"use client"

import { AppHeader } from "@/components/app-header"
import { NewSession } from "@/components/new-session"
import { Button } from "@/components/ui/button"
import { ErrorCard } from "@/components/ui/error-card"
import { useRelay } from "@/lib/relay-provider"
import { useAuth } from "@/lib/use-auth"
import { useHosts } from "@/lib/use-hosts"
import { controlChannel } from "@openremote/protocol"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

/**
 * Host detail — the per-host workspace. Connects to THIS host's account channel
 * (so sessions are its own, never mixed with other hosts), lists its sessions,
 * and starts new ones on it.
 */
export default function HostPage() {
  const params = useParams<{ id: string }>()
  const hostId = params.id
  const auth = useAuth()
  const router = useRouter()
  const { state, sendCommand, connectToHost } = useRelay()
  const { hosts, refresh } = useHosts()
  const searchParams = useSearchParams()
  // The machines-list "+ New session" CTA links here with ?new=1 — it can't
  // create inline (project/harness data needs a live connection), so this is
  // how it hands off into the existing flow.
  const [creating, setCreating] = useState(() => searchParams.get("new") === "1")

  const host = hosts.find((h) => h.id === hostId)

  // Auth gate.
  useEffect(() => {
    if (!auth.loading && !auth.signedIn) router.replace("/login")
  }, [auth.loading, auth.signedIn, router])

  // Connect to THIS host's channel (idempotent — safe to call on every render).
  useEffect(() => {
    if (auth.user?.id && hostId) connectToHost(controlChannel(hostId, auth.user.id))
  }, [auth.user?.id, hostId, connectToHost])

  // Ask for this host's sessions once connected.
  useEffect(() => {
    if (state.status === "connected") sendCommand({ type: "sessions.list" })
  }, [state.status, sendCommand])

  if (auth.loading || !auth.signedIn) {
    return (
      <>
        <AppHeader back={{ href: "/", label: "Machines" }} />
        <main className="flex flex-1 items-center justify-center px-6 text-sm text-neutral-500">
          Loading…
        </main>
      </>
    )
  }

  const sessions = state.sessions

  return (
    <>
      <AppHeader back={{ href: "/", label: "Machines" }} />
      <main className="flex-1 px-4 py-5">
        <div className="mb-1 flex items-center gap-2">
          <h1 className="text-base font-semibold text-neutral-100">{host?.name ?? "Machine"}</h1>
          {host && (
            <span
              className={`h-2 w-2 rounded-full ${host.status === "online" ? "bg-emerald-400" : "bg-neutral-600"}`}
            />
          )}
        </div>
        <p className="mb-5 text-xs text-neutral-500">
          {host ? `${host.status}${host.platform ? ` · ${host.platform}` : ""}` : ""}
          {state.status !== "connected" ? " · connecting…" : ""}
        </p>

        {host && host.status !== "online" && (
          <div className="mb-4">
            <ErrorCard
              title="Machine unreachable"
              description="This machine appears to be offline. Start it with `roamux host` on that computer to create or run sessions."
              onRetry={refresh}
            />
          </div>
        )}

        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
            Sessions
          </h2>
          {state.status === "connected" && !creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="text-xs font-medium text-emerald-400"
            >
              + New
            </button>
          )}
        </div>

        {creating && (
          <div className="mb-3">
            <NewSession hostId={hostId} onClose={() => setCreating(false)} />
          </div>
        )}

        {sessions.length === 0 ? (
          <div className="space-y-3 rounded-xl border border-dashed border-ink-line px-4 py-8 text-center text-sm text-neutral-500">
            <p>No sessions yet on this machine.</p>
            {state.status === "connected" && !creating ? (
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                + New session
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => (
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
