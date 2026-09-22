"use client"

import { AppHeader } from "@/components/app-header"
import { NewSession } from "@/components/new-session"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
        <main className="flex flex-1 items-center justify-center px-6 text-body text-text-muted">
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
          <h1 className="text-title font-semibold text-text">{host?.name ?? "Machine"}</h1>
          {host && <Badge status={host.status === "online" ? "online" : "offline"} />}
        </div>
        <p className="mb-5 text-caption text-text-muted">
          {host?.platform ?? ""}
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
          <h2 className="text-caption font-semibold uppercase tracking-widest text-text-muted">
            Sessions
          </h2>
          {state.status === "connected" && !creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="text-caption font-medium text-accent"
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
          <Card
            variant="outlined"
            className="space-y-3 border-dashed py-8 text-center text-body text-text-muted"
          >
            <p>No sessions yet on this machine.</p>
            {state.status === "connected" && !creating ? (
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                + New session
              </Button>
            ) : null}
          </Card>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/session/${encodeURIComponent(s.id)}`}
                  className="block rounded-2xl border border-paper-line/60 bg-paper-surface px-4 py-3 shadow-md shadow-text/10 transition-colors active:bg-paper-line"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-body font-medium text-text">{s.title}</div>
                      <div className="truncate text-caption text-text-muted">
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
  // "running" reuses `accent` (the live/nav-indicator color), matching
  // ui/badge.tsx's own rule — not a new color for the same semantic.
  const map: Record<string, string> = {
    idle: "text-text-muted",
    running: "text-accent",
    waiting: "text-warning",
    error: "text-error",
  }
  return (
    <span className={`shrink-0 text-caption ${map[status] ?? "text-text-muted"}`}>{status}</span>
  )
}
