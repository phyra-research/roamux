import { cn } from "@/lib/cn"
import { type ButtonHTMLAttributes, forwardRef } from "react"

export type ButtonVariant = "primary" | "secondary" | "danger" | "success" | "ghost"
export type ButtonSize = "sm" | "md"

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

// `primary`/`success` are solid fills with cream (`paper`) text — accent
// 10.05:1, success 4.83:1, both container-independent. Hover swaps to the
// darker `accent-hover` (12.28:1) rather than opacity-dimming: unlike the
// dark theme, `accent` DEFAULT already clears AA everywhere here, so a
// second shade exists purely for interaction feedback (#103).
// `danger` is bordered/outlined, not a tinted fill: a tint's contrast
// depends on the background behind it, and nested inside a Card (`paper-
// surface`), a `bg-error/10` fill falls to 4.34:1 — short of 4.5. Border +
// text color are both solid `error` (5.70:1), so it's compliant regardless
// of what it's sitting on.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-paper hover:bg-accent-hover active:opacity-80",
  secondary:
    "border border-paper-line bg-paper-surface text-text hover:border-accent active:bg-paper-line",
  danger: "border border-error text-error hover:bg-error/10 active:bg-error/20",
  success: "bg-success text-paper hover:opacity-90 active:opacity-80",
  ghost: "text-text-muted hover:text-text active:text-text",
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-caption",
  md: "px-4 py-2.5 text-body",
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      ) : null}
      {children}
    </button>
  )
})
