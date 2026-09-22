import { cn } from "@/lib/cn"
import { type HTMLAttributes, forwardRef } from "react"

export type CardVariant = "outlined" | "elevated"

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
}

const VARIANT_CLASSES: Record<CardVariant, string> = {
  outlined: "border border-paper-line bg-paper-surface",
  elevated: "border border-paper-line/60 bg-paper-surface shadow-md shadow-text/10",
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
