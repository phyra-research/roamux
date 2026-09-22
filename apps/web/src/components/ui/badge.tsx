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

// Solid fills with cream text, not a tinted pill on the ambient background —
// a tint's contrast depends on what's behind it, and nested inside Card's
// `paper-surface` background, a 10% tint of these colors caps out around
// 3.6-4.3:1 no matter how the opacity is tuned (surface is already close in
// luminance to them — more opacity makes it worse, not better, since the
// tint converges toward the text color). A solid fill is container-
// independent: cream text on success 4.83:1, error 5.70:1, text-muted
// 4.55:1. `running` reuses `accent` — the live/nav-indicator color, not a
// new one, same precedent as the dark theme's accent-bright pulse.
const FILL_CLASSES: Record<BadgeStatus, string> = {
  online: "bg-success text-paper",
  offline: "bg-text-muted text-paper",
  running: "bg-accent text-paper",
  done: "bg-success text-paper",
  failed: "bg-error text-paper",
}

const DOT_CLASSES: Record<BadgeStatus, string> = {
  online: "bg-paper",
  offline: "bg-paper",
  running: "bg-paper animate-pulse",
  done: "bg-paper",
  failed: "bg-paper",
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
        FILL_CLASSES[status],
        className,
      )}
      {...props}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASSES[status])} />
      {children ?? LABEL[status]}
    </span>
  )
})
