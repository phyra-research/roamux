import type { TimelineItem } from "@/components/tool-call"
import type { ReactNode } from "react"

export type Turn = {
  key: string
  items: TimelineItem[]
  /** False once this turn was closed by an assistant.message; true while
   * still accumulating — the current, in-progress turn. */
  open: boolean
}

/**
 * Buckets the flat (already tool-call-paired, #83) timeline into turns: each
 * assistant.message closes the turn that produced it, so its preceding tool
 * calls and file edits are grouped with it instead of reading as one flat
 * chronological list. Trailing activity with no message yet forms the final
 * "open" turn — where the live streaming box attaches (#85).
 *
 * This is a pragmatic substitute for the protocol's run.started/run.completed
 * boundaries, which relay-client.ts drops before they ever reach the
 * timeline — reusing them would mean changing that shared, untested reducer
 * for this one screen. assistant.message boundaries are derivable from data
 * already on hand.
 */
export function groupIntoTurns(items: TimelineItem[]): Turn[] {
  const turns: Turn[] = []
  let current: TimelineItem[] = []

  for (const item of items) {
    current.push(item)
    if (item.kind === "line" && item.entry.event.type === "assistant.message") {
      turns.push({ key: `turn:${item.entry.key}`, items: current, open: false })
      current = []
    }
  }
  if (current.length > 0) {
    // Non-null: guarded by current.length > 0 above.
    const first = current[0]!
    const key = first.kind === "line" ? first.entry.key : first.group.key
    turns.push({ key: `turn:${key}`, items: current, open: true })
  }

  return turns
}

function respondingLabel(model: string | undefined): string {
  const name = model?.split(" / ")[0]?.trim()
  return name ? `${name} is responding…` : "Agent is responding…"
}

/** The live "X is responding…" box — always rendered as part of the current turn. */
export function StreamingBox({ model, text }: { model: string | undefined; text: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-caption uppercase tracking-wider text-text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
        {respondingLabel(model)}
      </div>
      <div className="whitespace-pre-wrap text-body leading-relaxed text-text">
        {text}
        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-text-muted align-middle" />
      </div>
    </div>
  )
}

/**
 * Groups one turn's activity with a quiet connecting rail — tighter internal
 * spacing than the gap between turns. Neutral border, deliberately not
 * indigo: this is structural grouping, not a navigation/action affordance or
 * a semantic outcome, so per the design principle it stays uncolored.
 */
export function TurnBlock({ children }: { children: ReactNode }) {
  return <div className="space-y-2 border-l-2 border-paper-line pl-3">{children}</div>
}
