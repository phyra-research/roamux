"use client"

import { Onboarding } from "@/components/onboarding"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { type ApiHost, useHosts } from "@/lib/use-hosts"
import Link from "next/link"
import { useState } from "react"

/**
 * Account host list (control-plane), wired to GET /api/hosts. Each machine links
 * to /host/[id] — sessions are PER HOST, so you enter a machine to see and start
 * its sessions. No global auto-connect (that mixed sessions across hosts).
 */
export function MachinesList() {
  const { hosts, loading, error, signedIn, revoke, rename } = useHosts()
  const [showAdd, setShowAdd] = useState(false)

  if (!signedIn) {
    return (
      <Empty>
        <a href="/login" className="text-neutral-300 underline underline-offset-4">
          Sign in
        </a>{" "}
        to see your machines.
      </Empty>
    )
  }
  if (loading) return <Empty>Loading machines…</Empty>
  if (error) return <Empty>Couldn’t load machines: {error}</Empty>
  // No machines → onboarding is the whole view.
  if (hosts.length === 0) {
    return <Onboarding />
  }

  // With machines: list them, plus an always-available "Add machine" that reveals
  // the install instructions on demand.
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {hosts.map((host) => (
          <HostRow
            key={host.id}
            host={host}
            onRevoke={() => revoke(host.id)}
            onRename={(name) => rename(host.id, name)}
          />
        ))}
      </ul>

      {showAdd ? (
        <div className="space-y-2">
          <Onboarding />
          <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>
            Close
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="w-full rounded-xl border border-dashed border-ink-line px-4 py-3 text-body text-neutral-400 transition-colors hover:text-neutral-200"
        >
          + Add a machine
        </button>
      )}
    </div>
  )
}

function HostRow({
  host,
  onRevoke,
  onRename,
}: {
  host: ApiHost
  onRevoke: () => void
  onRename: (name: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [editing, setEditing] = useState(false)
  const online = host.status === "online"

  // Commit a rename: trim, skip no-ops and empties, then hand off to the parent.
  const commitRename = (raw: string) => {
    const name = raw.trim()
    setEditing(false)
    if (name && name !== host.name) onRename(name)
  }

  return (
    <li>
      <Card variant="outlined" className="flex items-center gap-3">
        {editing ? (
          <input
            type="text"
            defaultValue={host.name}
            // Focus + select on mount so the field is ready to overtype (the
            // input only mounts while editing, so this fires once per rename).
            ref={(el) => {
              el?.focus()
              el?.select()
            }}
            aria-label="Machine name"
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename(e.currentTarget.value)
              if (e.key === "Escape") setEditing(false)
            }}
            onBlur={(e) => commitRename(e.currentTarget.value)}
            className="min-w-0 flex-1 rounded-lg border border-ink-line bg-ink px-2 py-1 text-body font-medium text-neutral-100 outline-none focus:border-neutral-500"
          />
        ) : (
          /* Tapping the machine opens its own sessions (per-host). */
          <Link href={`/host/${encodeURIComponent(host.id)}`} className="min-w-0 flex-1">
            <div className="truncate text-body font-medium text-neutral-100">{host.name}</div>
            <div className="mt-1 flex items-center gap-2">
              <Badge status={online ? "online" : "offline"} />
              {host.platform ? (
                <span className="text-caption text-neutral-500">{host.platform}</span>
              ) : null}
            </div>
          </Link>
        )}
        {confirming ? (
          <div className="flex items-center gap-2">
            <Button variant="danger" size="sm" onClick={onRevoke}>
              Revoke
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          !editing && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-caption text-neutral-600 transition-colors hover:text-neutral-400"
                aria-label="Rename machine"
              >
                ✎
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="text-caption text-neutral-600 transition-colors hover:text-neutral-400"
                aria-label="Host options"
              >
                ⋯
              </button>
            </div>
          )
        )}
      </Card>
    </li>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Card variant="outlined" className="border-dashed py-8 text-center text-body text-neutral-500">
      {children}
    </Card>
  )
}
