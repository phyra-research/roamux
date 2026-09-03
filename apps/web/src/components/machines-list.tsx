"use client"

import { type ApiHost, useHosts } from "@/lib/use-hosts"
import { useState } from "react"

/**
 * Account host list (control-plane), wired to GET /api/hosts. Shows online/
 * offline state, last-seen, and a revoke action. Distinct from the Phase 1
 * relay-derived list — this reflects hosts registered to the signed-in account.
 */
export function MachinesList() {
  const { hosts, loading, error, signedIn, revoke } = useHosts()

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
  if (hosts.length === 0) {
    return (
      <Empty>
        No machines yet. Run <code className="text-neutral-400">openremote login</code> on a
        computer.
      </Empty>
    )
  }

  return (
    <ul className="space-y-2">
      {hosts.map((host) => (
        <HostRow key={host.id} host={host} onRevoke={() => revoke(host.id)} />
      ))}
    </ul>
  )
}

function HostRow({ host, onRevoke }: { host: ApiHost; onRevoke: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const online = host.status === "online"
  return (
    <li className="flex items-center gap-3 rounded-xl border border-ink-line bg-ink-soft px-4 py-3">
      <span
        className={`h-2.5 w-2.5 rounded-full ${online ? "bg-emerald-400" : "bg-neutral-600"}`}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-neutral-100">{host.name}</div>
        <div className="text-xs text-neutral-500">
          {host.status}
          {host.platform ? ` · ${host.platform}` : ""}
        </div>
      </div>
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
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-xs text-neutral-600 transition-colors hover:text-neutral-400"
        >
          ⋯
        </button>
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
