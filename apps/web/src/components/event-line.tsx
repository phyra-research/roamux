import { ErrorCard } from "@/components/ui/error-card"
import type { AgentEvent } from "@openremote/protocol"

/** Render one normalized agent event as a compact, scannable line. */
export function EventLine({ event }: { event: AgentEvent }) {
  switch (event.type) {
    case "session.started":
      return <Meta text="Session started" />
    case "terminal.output":
      // Inset code-block style (#105): light block with a subtle border,
      // matching the paper theme, rather than a dark-mode inset — applied
      // consistently with tool-call.tsx's verbose-output block.
      return (
        <pre className="overflow-x-auto rounded-lg border border-paper-line bg-paper px-3 py-2 font-mono text-caption text-text">
          {event.text}
        </pre>
      )
    case "file.changed":
      return <div className="font-mono text-caption text-text-muted">± {event.path}</div>
    case "assistant.message":
      // Prominent main content: unboxed, deep-blue, relaxed line-height —
      // the one role with no card/border, so it's what reads as "the point"
      // amid everything else on the page being boxed or muted.
      return (
        <div className="whitespace-pre-wrap text-body leading-relaxed text-text">{event.text}</div>
      )
    case "permission.resolved":
      return <Meta text={`Permission ${event.response === "allow" ? "allowed" : "denied"}`} />
    case "agent.waiting":
      return <Meta text="Agent waiting…" />
    case "agent.completed":
      return <Meta text="Done" />
    case "agent.failed":
      return <ErrorCard title="Command failed" description={event.error} />
    // permission.requested is rendered as an interactive card elsewhere;
    // diff.snapshot is rendered by <DiffView>, not as a timeline line.
    case "permission.requested":
    case "diff.snapshot":
    case "assistant.delta":
    // run.* are lifecycle markers (session/run split); not shown as timeline
    // lines in the V0 UI. A future run-grouped view will use them.
    case "run.started":
    case "run.completed":
    case "run.failed":
    // tool.started/tool.completed are paired into <ToolCallCard> (#83)
    // before the timeline ever reaches EventLine — never rendered here.
    case "tool.started":
    case "tool.completed":
      return null
  }
}

function Meta({ text }: { text: string }) {
  return <div className="text-caption uppercase tracking-wider text-text-muted">{text}</div>
}
