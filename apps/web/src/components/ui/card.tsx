import { cn } from "@/lib/cn"
import { type HTMLAttributes, forwardRef } from "react"

export type CardVariant = "outlined" | "elevated"

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
}

const VARIANT_CLASSES: Record<CardVariant, string> = {
  outlined: "border border-ink-line bg-ink-soft",
  elevated: "border border-ink-line/60 bg-ink-soft shadow-lg shadow-black/30",
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "outlined", className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn("rounded-2xl px-4 py-3", VARIANT_CLASSES[variant], className)}
      {...props}
    />
  )
})
