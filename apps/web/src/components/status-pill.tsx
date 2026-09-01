import type { ConnectionStatus } from "@/lib/types"

const LABEL: Record<ConnectionStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  connected: "Connected",
  unpaired: "Not paired",
}

const DOT: Record<ConnectionStatus, string> = {
  disconnected: "bg-neutral-500",
  connecting: "bg-amber-400 animate-pulse",
  connected: "bg-emerald-400",
  unpaired: "bg-neutral-500",
}

export function StatusPill({ status }: { status: ConnectionStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-neutral-400">
      <span className={`h-2 w-2 rounded-full ${DOT[status]}`} />
      {LABEL[status]}
    </span>
  )
}
