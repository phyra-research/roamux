import type { AgentEvent } from "@openremote/protocol"

/** Render one normalized agent event as a compact, scannable line. */
export function EventLine({ event }: { event: AgentEvent }) {
  switch (event.type) {
    case "session.started":
      return <Meta text="Session started" />
    case "tool.started":
      return (
        <div className="text-sm">
          <span className="text-sky-400">→ Running:</span>{" "}
          <span className="font-mono text-neutral-300">
            {describeTool(event.tool, event.input)}
          </span>
        </div>
      )
    case "tool.completed":
      return (
        <div className="text-sm">
          <span className="text-emerald-400">✓</span>{" "}
          <span className="font-mono text-neutral-400">{event.tool}</span>
        </div>
      )
    case "terminal.output":
      return (
        <pre className="overflow-x-auto rounded-lg bg-black/40 px-3 py-2 font-mono text-xs text-neutral-300">
          {event.text}
        </pre>
      )
    case "file.changed":
      return (
        <div className="text-sm text-neutral-400">
          <span className="text-violet-400">±</span> <span className="font-mono">{event.path}</span>
        </div>
      )
    case "assistant.message":
      return (
        <div className="whitespace-pre-wrap rounded-xl bg-ink-soft px-3 py-2 text-sm text-neutral-100">
          {event.text}
        </div>
      )
    case "permission.resolved":
      return <Meta text={`Permission ${event.response === "allow" ? "allowed" : "denied"}`} />
    case "agent.waiting":
      return <Meta text="Agent waiting…" />
    case "agent.completed":
      return <Meta text="Done" />
    case "agent.failed":
      return <div className="text-sm text-red-400">✗ {event.error}</div>
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
      return null
  }
}

function Meta({ text }: { text: string }) {
  return <div className="text-xs uppercase tracking-wider text-neutral-600">{text}</div>
}

function describeTool(tool: string, input: unknown): string {
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>
    const primary = obj.command ?? obj.pattern ?? obj.path ?? obj.filePath
    if (typeof primary === "string") return `${tool} ${primary}`
  }
  return tool
}
