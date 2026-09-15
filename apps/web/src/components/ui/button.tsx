import { cn } from "@/lib/cn"
import { type ButtonHTMLAttributes, forwardRef } from "react"

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost"
export type ButtonSize = "sm" | "md"

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

// `primary` uses accent-bright, not accent DEFAULT — DEFAULT (#6366F1) only
// clears 4.43:1 against the dark background, short of the 4.5:1 text bar.
// accent-bright (#818CF8) clears 6.63:1 with dark (text-ink) text. Hover/
// active dim via opacity rather than swapping to a less-contrasty color.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent-bright text-ink hover:opacity-90 active:opacity-80",
  secondary:
    "border border-ink-line bg-ink-soft text-neutral-100 hover:border-neutral-500 active:bg-ink-line",
  danger: "bg-red-500/10 text-red-400 hover:bg-red-500/20 active:bg-red-500/25",
  ghost: "text-neutral-400 hover:text-neutral-100 active:text-neutral-200",
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
