import type { AgentEvent } from "@openremote/protocol"
import { newId } from "@openremote/protocol"

/**
 * Derives run boundaries from the normalized agent event stream, giving us the
 * session-vs-run split (#9) WITHOUT changing any HarnessAdapter.
 *
 * A **session** is long-lived (host+project+harness). A **run** is one unit of
 * work inside it. In V0 adapters don't emit run events, so we synthesize them:
 *
 *   - the first activity after idle (session.started / assistant.* / tool.* /
 *     agent.waiting) opens a run  → emit `run.started` (+ carry its runId)
 *   - `agent.completed`                                   → emit `run.completed`
 *   - `agent.failed`                                      → emit `run.failed`
 *
 * `annotate` takes one incoming event for a session and returns the ordered list
 * of events to actually forward — the original event, plus any run.* lifecycle
 * event, each paired with the runId it belongs to (so the pump can put it on the
 * envelope). Behavior-preserving: the original events still flow unchanged; run
 * events are purely additive.
 */
export type AnnotatedEvent = { event: AgentEvent; runId: string | undefined }

const OPENS_RUN = new Set<AgentEvent["type"]>([
  "session.started",
  "assistant.delta",
  "assistant.message",
  "tool.started",
  "agent.waiting",
  "permission.requested",
])

export class RunTracker {
  /** sessionId → the currently-open runId, if a run is in progress. */
  private readonly openRun = new Map<string, string>()

  annotate(sessionId: string, event: AgentEvent): AnnotatedEvent[] {
    const out: AnnotatedEvent[] = []
    let runId = this.openRun.get(sessionId)

    // Open a run lazily on the first activity of a new unit of work.
    if (!runId && OPENS_RUN.has(event.type)) {
      runId = newId()
      this.openRun.set(sessionId, runId)
      out.push({ event: { type: "run.started", runId }, runId })
    }

    // The triggering event itself, tagged with the active run (if any).
    out.push({ event, runId })

    // Close the run on terminal events.
    if (event.type === "agent.completed" && runId) {
      out.push({ event: { type: "run.completed", runId }, runId })
      this.openRun.delete(sessionId)
    } else if (event.type === "agent.failed" && runId) {
      out.push({ event: { type: "run.failed", runId, error: event.error }, runId })
      this.openRun.delete(sessionId)
    }

    return out
  }
}
