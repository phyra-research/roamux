"use client"

import { type TimelineItem, primaryArg, toolLabel } from "@/components/tool-call"
import type { Turn } from "@/components/turn"
import { Badge } from "@/components/ui/badge"
import type { TimelineEntry } from "@/lib/types"
import { useEffect, useRef, useState } from "react"

export type StatusPhase = "idle" | "running" | "done" | "failed"

export type StatusStripState = {
  phase: StatusPhase
  /** Present only in "running" phase, when a tool is currently mid-flight. */
  action?: { tool: string; arg?: string }
  /** Best available anchor for the elapsed timer: the first tool.started of
   * the current open turn, when one exists. Undefined when the run is
   * streaming text with no tool call yet this turn — the component falls
   * back to the moment it first observed "running" itself. There's no
   * run.started timestamp available here: relay-client.ts drops run.*
   * before they reach the timeline, and this issue doesn't touch that file. */
  runningSince?: number
}

/**
 * Derives the status strip's phase/action/timer-anchor from data the session
 * page already computes — the flat timeline, #83's tool-call items, and
 * #85's turns — rather than any new state in relay-client.ts.
 *
 * Idle vs. Done aren't distinguishable from session.status alone (relay-
 * client.ts maps both "never started" and "just finished" to "idle"), so
 * phase is derived by scanning for the last agent.completed/agent.failed in
 * the timeline; isRunning always wins over that history, so a second prompt
 * after a completed run correctly flips back to "running".
 */
export function deriveStatusStrip(
  timeline: TimelineEntry[],
  items: TimelineItem[],
  turns: Turn[],
  isRunning: boolean,
): StatusStripState {
  if (!isRunning) {
    const last = [...timeline]
      .reverse()
      .find((e) => e.event.type === "agent.completed" || e.event.type === "agent.failed")
    if (!last) return { phase: "idle" }
    return { phase: last.event.type === "agent.failed" ? "failed" : "done" }
  }

  const runningTool = [...items]
    .reverse()
    .find((item) => item.kind === "tool-call" && item.group.status === "running")
  const action =
    runningTool?.kind === "tool-call"
      ? { tool: runningTool.group.tool, arg: primaryArg(runningTool.group.input) }
      : undefined

  const lastTurn = turns[turns.length - 1]
  const firstItem = lastTurn?.open ? lastTurn.items[0] : undefined
  const runningSince = firstItem
    ? firstItem.kind === "line"
      ? firstItem.entry.at
      : firstItem.group.startedAt
    : undefined

  return { phase: "running", action, runningSince }
}

// Common tool names → present-tense verb, for the "X is <verb>ing" phrasing
// the issue asks for. Lowercased lookup so adapter casing ("Bash" vs "bash")
// doesn't matter. Unknown tools fall back to their plain name — no invented
// verb for a tool this map hasn't seen.
const VERB_BY_TOOL: Record<string, string> = {
  edit: "editing",
  multiedit: "editing",
  write: "writing",
  read: "reading",
  bash: "running",
  grep: "searching",
  glob: "searching",
  webfetch: "fetching",
  todowrite: "updating todos",
}

function shortModelName(model: string | undefined): string {
  return model?.split(" / ")[0]?.trim() || "Agent"
}

function currentActionText(
  model: string | undefined,
  tool: string,
  arg: string | undefined,
): string {
  const subject = shortModelName(model)
  const verb = VERB_BY_TOOL[tool.toLowerCase()]
  if (verb) {
    return arg ? `${subject} is ${verb} ${arg}` : `${subject} is ${verb}`
  }
  const label = toolLabel(tool)
  return arg ? `${subject} is using ${label}: ${arg}` : `${subject} is using ${label}`
}

function formatMMSS(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function StatusStrip({
  state,
  model,
  streaming,
}: {
  state: StatusStripState
  model: string | undefined
  streaming: boolean
}) {
  // Fallback timer anchor: the moment this component first observes
  // "running", for the case deriveStatusStrip has no timeline evidence yet
  // (streaming text, no tool call fired this turn).
  const fallbackSince = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (state.phase === "running") {
      if (fallbackSince.current === undefined) fallbackSince.current = Date.now()
    } else {
      fallbackSince.current = undefined
    }
  }, [state.phase])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (state.phase !== "running") return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [state.phase])

  if (state.phase === "idle") {
    return (
      <div className="border-b border-paper-line px-4 py-2">
        <Badge status="offline">Ready to start</Badge>
      </div>
    )
  }
  if (state.phase === "done") {
    return (
      <div className="border-b border-paper-line px-4 py-2">
        <Badge status="done">✓ Done</Badge>
      </div>
    )
  }
  if (state.phase === "failed") {
    return (
      <div className="border-b border-paper-line px-4 py-2">
        <Badge status="failed">✗ Failed</Badge>
      </div>
    )
  }

  const since = state.runningSince ?? fallbackSince.current
  const elapsed = formatMMSS(now - (since ?? now))
  const description = state.action
    ? currentActionText(model, state.action.tool, state.action.arg)
    : streaming
      ? `${shortModelName(model)} is responding…`
      : "Working…"

  return (
    <div className="flex items-center gap-2 border-b border-paper-line px-4 py-2">
      <Badge status="running">Running</Badge>
      <span className="min-w-0 flex-1 truncate text-caption text-text-muted">
        {description} · {elapsed}
      </span>
    </div>
  )
}
