"use client"

import { AppHeader } from "@/components/app-header"
import { DiffView } from "@/components/diff-view"
import { EventLine } from "@/components/event-line"
import { PermissionCard } from "@/components/permission-card"
import { StatusStrip, deriveStatusStrip } from "@/components/status-strip"
import { ToolCallCard, groupTimelineEntries } from "@/components/tool-call"
import { StreamingBox, TurnBlock, groupIntoTurns } from "@/components/turn"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useRelay } from "@/lib/relay-provider"
import { use, useEffect, useMemo, useRef, useState } from "react"

const SUGGESTED_PROMPT = "Read README.md and tell me what this project does"

/** Offline prompt queue (#112) — sessionStorage-backed so it survives a
 * reload during an outage, per-session-scoped so switching sessions doesn't
 * cross-contaminate. Capped at MAX_QUEUED_PROMPTS to avoid an unbounded
 * queue if someone keeps typing through a long outage — the oldest queued
 * prompt is dropped to make room, since by the time a very long outage ends
 * the earliest draft is the most likely to already be stale. */
const MAX_QUEUED_PROMPTS = 5
const QUEUE_KEY_PREFIX = "openremote.queue."

function queueKey(sessionId: string): string {
  return `${QUEUE_KEY_PREFIX}${sessionId}`
}

function readQueue(sessionId: string): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.sessionStorage.getItem(queueKey(sessionId))
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    // Malformed JSON from a previous version, or storage disabled — treat as empty.
    return []
  }
}

function writeQueue(sessionId: string, queue: string[]): void {
  if (typeof window === "undefined") return
  try {
    if (queue.length === 0) window.sessionStorage.removeItem(queueKey(sessionId))
    else window.sessionStorage.setItem(queueKey(sessionId), JSON.stringify(queue))
  } catch {
    // Private-browsing/storage-full edge cases — the queue then only lives
    // in React state for the rest of this page instance.
  }
}

// TODO(#110): once history-snapshot restoration lands (server-side support
// from #109), this should sendCommand({ type: "history.snapshot", sessionId })
// to refill the timeline after a reconnect. No-op stub until then — the
// existing in-memory timeline (never cleared by a disconnect) is what's
// shown in the meantime.
function requestHistoryRestore(_sessionId: string): void {}

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const sessionId = decodeURIComponent(id)
  const { state, sendCommand } = useRelay()
  const [text, setText] = useState("")
  const [queuedPrompts, setQueuedPrompts] = useState<string[]>(() => readQueue(sessionId))
  const streamEndRef = useRef<HTMLDivElement>(null)

  const session = state.sessions.find((s) => s.id === sessionId)
  const timeline = state.timelines[sessionId] ?? []
  const streaming = state.streaming[sessionId] ?? ""
  const permission = state.permissions[sessionId]
  const isRunning = session?.status === "running" || streaming.length > 0
  const items = useMemo(() => groupTimelineEntries(timeline, isRunning), [timeline, isRunning])
  const turns = useMemo(() => groupIntoTurns(items), [items])
  const lastTurnOpen = turns.length > 0 && (turns[turns.length - 1]?.open ?? false)
  const statusState = useMemo(
    () => deriveStatusStrip(timeline, items, turns, isRunning),
    [timeline, items, turns, isRunning],
  )
  // Latches true on the first successful load and never resets — a later
  // disconnect must NOT swap the real feed back to skeletons (#112). Neither
  // `timelines` nor `sessions` are cleared by a disconnect, so the already-
  // loaded content stays valid and visible; the header's reconnecting banner
  // communicates the drop instead of blanking the screen.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  useEffect(() => {
    if (state.status === "connected" && session) setHasLoadedOnce(true)
  }, [state.status, session])
  const isLoadingSession = !hasLoadedOnce

  // Ask the host for a fresh session list on mount (covers deep links).
  useEffect(() => {
    if (state.status === "connected") sendCommand({ type: "sessions.list" })
  }, [state.status, sendCommand])

  // On becoming connected — first load AND every reconnect — flush anything
  // queued while offline and kick off history restore (#112). Firing on
  // first connect too (not just reconnects) is deliberate: a queue left over
  // in sessionStorage from a reloaded tab should still flush, and history
  // restore should eventually cover the initial load the same way.
  const connected = state.status === "connected"
  useEffect(() => {
    if (!connected) return
    requestHistoryRestore(sessionId)
    setQueuedPrompts((current) => {
      if (current.length === 0) return current
      for (const t of current) sendCommand({ type: "prompt.send", sessionId, text: t })
      writeQueue(sessionId, [])
      return []
    })
  }, [connected, sessionId, sendCommand])

  // Auto-scroll to the latest activity.
  const permissionId = permission?.permissionId
  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [timeline.length, streaming, permissionId])

  const send = () => {
    const t = text.trim()
    if (!t) return
    if (state.status === "connected") {
      sendCommand({ type: "prompt.send", sessionId, text: t })
    } else {
      setQueuedPrompts((current) => {
        const next = [...current, t].slice(-MAX_QUEUED_PROMPTS)
        writeQueue(sessionId, next)
        return next
      })
    }
    setText("")
  }

  return (
    <>
      <AppHeader back={{ href: "/", label: "Back to machines" }} />

      <div className="border-b border-paper-line px-4 py-3">
        <div className="text-title font-semibold text-text">{session?.title ?? sessionId}</div>
        <div className="text-caption text-text-muted">{session?.model ?? "agent"}</div>
      </div>

      <StatusStrip state={statusState} model={session?.model} streaming={streaming.length > 0} />

      <main className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <DiffView sessionId={sessionId} />

        {isLoadingSession ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="ml-4 h-24 w-3/4 rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
          </div>
        ) : timeline.length === 0 && !streaming && !permission ? (
          <div className="space-y-3 py-10 text-center">
            <p className="text-body text-text-muted">No activity yet.</p>
            <Button variant="primary" size="sm" onClick={() => setText(SUGGESTED_PROMPT)}>
              Try: “{SUGGESTED_PROMPT}”
            </Button>
          </div>
        ) : null}

        {isLoadingSession ? null : (
          <>
            {turns.map((turn) => (
              <TurnBlock key={turn.key}>
                {turn.items.map((item) =>
                  item.kind === "tool-call" ? (
                    <ToolCallCard key={item.group.key} group={item.group} />
                  ) : (
                    <EventLine key={item.entry.key} event={item.entry.event} />
                  ),
                )}
                {turn.open && streaming ? (
                  <StreamingBox model={session?.model} text={streaming} />
                ) : null}
              </TurnBlock>
            ))}

            {streaming && !lastTurnOpen ? (
              <TurnBlock>
                <StreamingBox model={session?.model} text={streaming} />
              </TurnBlock>
            ) : null}

            {permission ? (
              <PermissionCard
                permission={permission}
                onRespond={(response) =>
                  sendCommand({
                    type: "permission.respond",
                    sessionId,
                    permissionId: permission.permissionId,
                    response,
                  })
                }
              />
            ) : null}
          </>
        )}

        <div ref={streamEndRef} />
      </main>

      <footer className="sticky bottom-0 space-y-2 border-t border-paper-line bg-paper/90 px-4 py-3 backdrop-blur">
        {queuedPrompts.length > 0 ? (
          <p className="text-caption text-warning">
            {queuedPrompts.length} prompt{queuedPrompts.length > 1 ? "s" : ""} queued — sending once
            reconnected
          </p>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                send()
              }
            }}
            rows={1}
            placeholder="Tell the agent what to do…"
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-paper-line bg-paper-surface px-3 py-2.5 text-body text-text outline-none focus:border-accent"
          />
          <Button variant="primary" onClick={send} disabled={!text.trim()}>
            Send
          </Button>
        </div>
        <Button
          variant="danger"
          className="w-full"
          onClick={() => sendCommand({ type: "session.abort", sessionId })}
          disabled={!isRunning}
        >
          Stop
        </Button>
      </footer>
    </>
  )
}
