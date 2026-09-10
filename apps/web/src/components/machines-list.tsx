"use client"

import { Onboarding } from "@/components/onboarding"
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
          <button
            type="button"
            onClick={() => setShowAdd(false)}
            className="text-xs text-neutral-500"
          >
            Close
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="w-full rounded-xl border border-dashed border-ink-line px-4 py-3 text-sm text-neutral-400 transition-colors hover:text-neutral-200"
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
    <li className="flex items-center gap-3 rounded-xl border border-ink-line bg-ink-soft px-4 py-3">
      <span
        className={`h-2.5 w-2.5 rounded-full ${online ? "bg-emerald-400" : "bg-neutral-600"}`}
      />
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
          className="min-w-0 flex-1 rounded-lg border border-ink-line bg-ink px-2 py-1 text-sm font-medium text-neutral-100 outline-none focus:border-neutral-500"
        />
      ) : (
        /* Tapping the machine opens its own sessions (per-host). */
        <Link href={`/host/${encodeURIComponent(host.id)}`} className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-neutral-100">{host.name}</div>
          <div className="text-xs text-neutral-500">
            {host.status}
            {host.platform ? ` · ${host.platform}` : ""}
          </div>
        </Link>
      )}
      {confirming ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRevoke}
            className="rounded-lg bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-400"
          >
            Revoke
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-xs text-neutral-500"
          >
            Cancel
          </button>
        </div>
      ) : (
        !editing && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-neutral-600 transition-colors hover:text-neutral-400"
              aria-label="Rename machine"
            >
              ✎
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-xs text-neutral-600 transition-colors hover:text-neutral-400"
              aria-label="Host options"
            >
              ⋯
            </button>
          </div>
        )
      )}
    </li>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-line px-4 py-8 text-center text-sm text-neutral-500">
      {children}
    </div>
  )
}
