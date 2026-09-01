"use client"

import type { PendingPermission } from "@/lib/types"

/**
 * The headline product feature: a remote allow/deny prompt. When the agent
 * requests permission, this card appears and the two buttons send a
 * permission.respond command back through the relay to the host.
 */
export function PermissionCard({
  permission,
  onRespond,
}: {
  permission: PendingPermission
  onRespond: (response: "allow" | "deny") => void
}) {
  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
        <span>⚠</span> Permission required
      </div>
      <p className="mt-2 font-mono text-sm text-neutral-100">{permission.description}</p>
      {permission.tool ? (
        <p className="mt-1 text-xs text-neutral-500">tool: {permission.tool}</p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => onRespond("deny")}
          className="flex-1 rounded-xl border border-ink-line px-4 py-2.5 text-sm font-medium text-neutral-200 active:bg-ink-line"
        >
          Deny
        </button>
        <button
          type="button"
          onClick={() => onRespond("allow")}
          className="flex-1 rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-semibold text-ink active:opacity-80"
        >
          Allow
        </button>
      </div>
    </div>
  )
}
