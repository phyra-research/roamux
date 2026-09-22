"use client"

import { Button } from "@/components/ui/button"
import type { PendingPermission } from "@/lib/types"

/**
 * The headline product feature: a remote allow/deny prompt. When the agent
 * requests permission, this card appears and the two buttons send a
 * permission.respond command back through the relay to the host.
 *
 * Not built on the shared <Card> primitive: Card's own variant classes set
 * border-color and background, and this needs a warning-tinted border/bg
 * instead — overriding via className isn't reliable (conflicting Tailwind
 * utilities resolve by generated-stylesheet order, not by prop order, per
 * cn.ts's own documented caveat), so this matches Card's shape constants
 * (rounded-2xl px-4 py-3) directly rather than risk the override.
 */
export function PermissionCard({
  permission,
  onRespond,
}: {
  permission: PendingPermission
  onRespond: (response: "allow" | "deny") => void
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-warning/40 bg-warning/5 px-4 py-3">
      <div className="flex items-center gap-2 text-body font-semibold text-warning">
        <span>⚠</span> Permission required
      </div>
      <p className="font-mono text-body text-text">{permission.description}</p>
      {permission.tool ? (
        <p className="text-caption text-text-muted">tool: {permission.tool}</p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="danger" className="flex-1" onClick={() => onRespond("deny")}>
          Deny
        </Button>
        <Button variant="success" className="flex-1" onClick={() => onRespond("allow")}>
          Allow
        </Button>
      </div>
    </div>
  )
}
