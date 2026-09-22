import type { ConnectionStatus } from "@/lib/types"

const LABEL: Record<ConnectionStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  connected: "Connected",
  unpaired: "Not paired",
}

// Dots are non-text UI (3:1 bar, not 4.5:1) — verified against `paper`
// (#FAF1CA): success 4.83:1, warning 6.25:1, text-muted 4.54:1. The old
// dark-theme dots (amber-400 1.47:1, emerald-400 1.69:1) failed badly here.
const DOT: Record<ConnectionStatus, string> = {
  disconnected: "bg-text-muted",
  connecting: "bg-warning animate-pulse",
  connected: "bg-success",
  unpaired: "bg-text-muted",
}

export function StatusPill({ status }: { status: ConnectionStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-caption text-text-muted">
      <span className={`h-2 w-2 rounded-full ${DOT[status]}`} />
      {LABEL[status]}
    </span>
  )
}
