import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

/**
 * Reusable error surface: neutral card background, subtle red accent on the
 * icon/border only (semantic red, per the design principle — the card itself
 * stays neutral, it doesn't turn red). Used for host-offline, fetch failures,
 * and agent.failed in the timeline.
 */
export function ErrorCard({
  title,
  description,
  onRetry,
}: {
  title: string
  description?: string
  onRetry?: () => void
}) {
  return (
    <Card variant="outlined" className="space-y-2 border-red-500/30">
      <div className="flex items-center gap-2 text-body font-medium text-red-400">
        <span>✗</span> {title}
      </div>
      {description ? <p className="text-caption text-neutral-500">{description}</p> : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </Card>
  )
}
