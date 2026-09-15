import { cn } from "@/lib/cn"
import { type HTMLAttributes, forwardRef } from "react"

export type BadgeStatus = "online" | "offline" | "running" | "done" | "failed"

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: BadgeStatus
}

const LABEL: Record<BadgeStatus, string> = {
  online: "Online",
  offline: "Offline",
  running: "Running",
  done: "Done",
  failed: "Failed",
}

// Dot + text share a color per status. `running` is the one live/in-progress
// state and uses the accent color (bright, so the text clears AA — see
// tailwind.config.ts token comments); everything else reuses the app's
// existing emerald/red/neutral semantics.
const DOT_CLASSES: Record<BadgeStatus, string> = {
  online: "bg-emerald-400",
  offline: "bg-neutral-600",
  running: "bg-accent-bright animate-pulse",
  done: "bg-emerald-400",
  failed: "bg-red-400",
}

const TEXT_CLASSES: Record<BadgeStatus, string> = {
  online: "text-emerald-300",
  offline: "text-neutral-400",
  running: "text-accent-bright",
  done: "text-emerald-300",
  failed: "text-red-300",
}

const BG_CLASSES: Record<BadgeStatus, string> = {
  online: "bg-emerald-500/10",
  offline: "bg-neutral-500/10",
  running: "bg-accent/10",
  done: "bg-emerald-500/10",
  failed: "bg-red-500/10",
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { status, className, children, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-medium",
        BG_CLASSES[status],
        TEXT_CLASSES[status],
        className,
      )}
      {...props}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASSES[status])} />
      {children ?? LABEL[status]}
    </span>
  )
})
