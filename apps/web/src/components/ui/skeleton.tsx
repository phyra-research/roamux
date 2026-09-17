import { cn } from "@/lib/cn"
import type { HTMLAttributes } from "react"

/** A pulsing placeholder block. Size it per call site to match the real content it stands in for. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-lg bg-ink-line/60", className)} {...props} />
}
