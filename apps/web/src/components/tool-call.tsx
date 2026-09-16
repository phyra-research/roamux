"use client"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import type { TimelineEntry } from "@/lib/types"
import { useState } from "react"

type ToolCallStatus = "running" | "done" | "failed" | "interrupted"

export type ToolCallGroup = {
  key: string
  tool: string
  input?: unknown
  output?: unknown
  startedAt?: number
  completedAt?: number
  status: ToolCallStatus
}

export type TimelineItem =
  | { kind: "line"; entry: TimelineEntry }
  | { kind: "tool-call"; group: ToolCallGroup }

const LONG_CONTENT_THRESHOLD = 200

/**
 * Pairs tool.started/tool.completed entries (matched by callId) into single
 * groups so the session view renders one card per tool call instead of two
 * disconnected lines. Every adapter sets callId (mock-adapter.ts included,
 * as of #83), so this is a plain lookup — no positional fallback needed.
 *
 * `sessionRunning` resolves the one case callId can't: a tool.started that
 * never got a tool.completed. If the session has ended, that group is
 * relabeled "interrupted" instead of spinning forever.
 */
export function groupTimelineEntries(
  entries: TimelineEntry[],
  sessionRunning: boolean,
): TimelineItem[] {
  const items: TimelineItem[] = []
  const pending = new Map<string, ToolCallGroup>()

  for (const entry of entries) {
    const { event } = entry
    if (event.type === "tool.started") {
      const group: ToolCallGroup = {
        key: `tool:${entry.key}`,
        tool: event.tool,
        input: event.input,
        startedAt: entry.at,
        status: "running",
      }
      items.push({ kind: "tool-call", group })
      if (event.callId) pending.set(event.callId, group)
      continue
    }
    if (event.type === "tool.completed") {
      const match = event.callId ? pending.get(event.callId) : undefined
      if (match) {
        pending.delete(event.callId as string)
        match.output = event.output
        match.completedAt = entry.at
        match.status = looksFailed(event.output) ? "failed" : "done"
        continue
      }
      // Orphaned: a completion with no matching start (e.g. a reconnect that
      // missed the earlier event). Render standalone — no spinner, no elapsed.
      items.push({
        kind: "tool-call",
        group: {
          key: `tool:${entry.key}`,
          tool: event.tool,
          output: event.output,
          completedAt: entry.at,
          status: looksFailed(event.output) ? "failed" : "done",
        },
      })
      continue
    }
    items.push({ kind: "line", entry })
  }

  if (!sessionRunning) {
    for (const item of items) {
      if (item.kind === "tool-call" && item.group.status === "running") {
        item.group.status = "interrupted"
      }
    }
  }

  return items
}

// The protocol carries no success/failure signal on tool.completed (only
// `output: unknown`) — some adapters (opencode) fold an error into `output`
// instead. This is a best-effort read of that payload, not authoritative.
function looksFailed(output: unknown): boolean {
  if (output == null) return false
  if (typeof output === "string") {
    return (
      /^\s*(error|exception|traceback)\b/i.test(output) || /\berror:/i.test(output.slice(0, 200))
    )
  }
  if (typeof output === "object") {
    const obj = output as Record<string, unknown>
    return typeof obj.error === "string" || obj.isError === true || obj.is_error === true
  }
  return false
}

export function primaryArg(input: unknown): string | undefined {
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>
    const primary = obj.command ?? obj.pattern ?? obj.path ?? obj.filePath ?? obj.file_path
    if (typeof primary === "string") return primary
  }
  return undefined
}

export function toolLabel(tool: string): string {
  return tool.length > 0 ? tool[0].toUpperCase() + tool.slice(1) : tool
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) {
    const s = (ms / 1000).toFixed(1)
    return `${s.endsWith(".0") ? s.slice(0, -2) : s}s`
  }
  const totalSeconds = Math.round(ms / 1000)
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`
}

function contentToShow(group: ToolCallGroup): string | undefined {
  const raw = group.status === "running" ? group.input : (group.output ?? group.input)
  if (raw === undefined) return undefined
  return typeof raw === "string" ? raw : JSON.stringify(raw, null, 2)
}

function isLong(text: string): boolean {
  return text.length > LONG_CONTENT_THRESHOLD || text.split("\n").length > 4
}

export function ToolCallCard({ group }: { group: ToolCallGroup }) {
  const [expanded, setExpanded] = useState(false)
  const arg = primaryArg(group.input)
  const content = contentToShow(group)
  const long = content ? isLong(content) : false
  const preview = content?.split("\n")[0]?.slice(0, 120)

  return (
    <Card variant="elevated" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-title font-semibold text-neutral-100">
            {toolLabel(group.tool)}
          </div>
          {arg ? <div className="truncate text-caption text-neutral-500">{arg}</div> : null}
        </div>
        <StatusIndicator group={group} />
      </div>

      {content ? (
        long && !expanded ? (
          <div>
            <p className="truncate font-mono text-caption text-neutral-400">{preview}</p>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-1 text-caption font-medium text-accent-bright"
            >
              Show more
            </button>
          </div>
        ) : (
          <div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 px-3 py-2 font-mono text-caption text-neutral-300">
              {content}
            </pre>
            {long ? (
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="mt-1 text-caption font-medium text-accent-bright"
              >
                Show less
              </button>
            ) : null}
          </div>
        )
      ) : null}
    </Card>
  )
}

function StatusIndicator({ group }: { group: ToolCallGroup }) {
  if (group.status === "running") {
    return (
      <span
        className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-accent-bright border-t-transparent"
        aria-label="Running"
      />
    )
  }
  if (group.status === "interrupted") {
    return <Badge status="offline">Interrupted</Badge>
  }
  if (group.status === "failed") {
    return <Badge status="failed">✗ Failed</Badge>
  }
  const elapsed =
    group.startedAt !== undefined && group.completedAt !== undefined
      ? formatElapsed(group.completedAt - group.startedAt)
      : undefined
  return <Badge status="done">{elapsed ? `✓ ${elapsed}` : "✓ Done"}</Badge>
}
