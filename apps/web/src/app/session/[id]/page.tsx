"use client"

import { AppHeader } from "@/components/app-header"
import { DiffView } from "@/components/diff-view"
import { EventLine } from "@/components/event-line"
import { PermissionCard } from "@/components/permission-card"
import { StatusStrip, deriveStatusStrip } from "@/components/status-strip"
import { ToolCallCard, groupTimelineEntries } from "@/components/tool-call"
import { StreamingBox, type Turn, TurnBlock, groupIntoTurns } from "@/components/turn"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useRelay } from "@/lib/relay-provider"
import type { PendingCommand, PendingCommandKind } from "@/lib/types"
import { use, useEffect, useMemo, useRef, useState } from "react"

const SUGGESTED_PROMPT = "Read README.md and tell me what this project does"

/** Ordered feed row: a real turn, or a locally-echoed pending prompt (#111)
 * interleaved by timestamp so a new send lands in the right spot relative to
 * older turns instead of always pinning to the bottom. */
type FeedRow =
  | { kind: "turn"; at: number; turn: Turn }
  | { kind: "echo"; at: number; pending: PendingCommand }

function turnStartTime(turn: Turn): number {
  const first = turn.items[0]
  if (!first) return 0
  return first.kind === "line" ? first.entry.at : (first.group.startedAt ?? 0)
}

/** The most recently created pending command of `kind` for this session, if any. */
function latestPending(
  pendingCommands: Record<string, PendingCommand>,
  sessionId: string,
  kind: PendingCommandKind,
): PendingCommand | undefined {
  let latest: PendingCommand | undefined
  for (const cmd of Object.values(pendingCommands)) {
    if (cmd.sessionId !== sessionId || cmd.kind !== kind) continue
    if (!latest || cmd.createdAt > latest.createdAt) latest = cmd
  }
  return latest
}

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const sessionId = decodeURIComponent(id)
  const { state, sendCommand, sendCommandOptimistic, retryCommand } = useRelay()
  const [text, setText] = useState("")
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
  // Distinguishes "still connecting/haven't heard about this session yet" from
  // a genuinely empty timeline — otherwise a slow connection briefly shows
  // "No activity yet" before the session data has even arrived.
  const isLoadingSession = state.status !== "connected" || !session

  // Optimistic command tracking (#111) — derived straight from relay state
  // each render rather than local refs, so a second send/permission before
  // the first resolves can never point a button at a stale id.
  const pendingPrompts = useMemo(
    () =>
      Object.values(state.pendingCommands).filter(
        (p) => p.sessionId === sessionId && p.kind === "prompt",
      ),
    [state.pendingCommands, sessionId],
  )
  const sendPending = pendingPrompts.reduce<PendingCommand | undefined>(
    (latest, p) => (!latest || p.createdAt > latest.createdAt ? p : latest),
    undefined,
  )
  const abortPending = latestPending(state.pendingCommands, sessionId, "abort")
  const permissionPending = permission
    ? Object.values(state.pendingCommands).find(
        (p) =>
          p.kind === "permission" &&
          p.sessionId === sessionId &&
          p.command.type === "permission.respond" &&
          p.command.permissionId === permission.permissionId,
      )
    : undefined

  const feedRows = useMemo<FeedRow[]>(() => {
    const rows: FeedRow[] = turns.map((turn) => ({ kind: "turn", at: turnStartTime(turn), turn }))
    for (const p of pendingPrompts) rows.push({ kind: "echo", at: p.createdAt, pending: p })
    return rows.sort((a, b) => a.at - b.at)
  }, [turns, pendingPrompts])

  // Ask the host for a fresh session list on mount (covers deep links).
  useEffect(() => {
    if (state.status === "connected") sendCommand({ type: "sessions.list" })
  }, [state.status, sendCommand])

  // Auto-scroll to the latest activity.
  const permissionId = permission?.permissionId
  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [timeline.length, streaming, permissionId, pendingPrompts.length])

  const send = () => {
    const t = text.trim()
    if (!t) return
    sendCommandOptimistic({ type: "prompt.send", sessionId, text: t }, { kind: "prompt", text: t })
    setText("")
  }

  const abort = () => {
    sendCommandOptimistic({ type: "session.abort", sessionId }, { kind: "abort" })
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
        ) : timeline.length === 0 && !streaming && !permission && pendingPrompts.length === 0 ? (
          <div className="space-y-3 py-10 text-center">
            <p className="text-body text-text-muted">No activity yet.</p>
            <Button variant="primary" size="sm" onClick={() => setText(SUGGESTED_PROMPT)}>
              Try: “{SUGGESTED_PROMPT}”
            </Button>
          </div>
        ) : null}

        {isLoadingSession ? null : (
          <>
            {feedRows.map((row) =>
              row.kind === "echo" ? (
                <PromptEcho key={row.pending.id} pending={row.pending} onRetry={retryCommand} />
              ) : (
                <TurnBlock key={row.turn.key}>
                  {row.turn.items.map((item) =>
                    item.kind === "tool-call" ? (
                      <ToolCallCard key={item.group.key} group={item.group} />
                    ) : (
                      <EventLine key={item.entry.key} event={item.entry.event} />
                    ),
                  )}
                  {row.turn.open && streaming ? (
                    <StreamingBox model={session?.model} text={streaming} />
                  ) : null}
                </TurnBlock>
              ),
            )}

            {streaming && !lastTurnOpen ? (
              <TurnBlock>
                <StreamingBox model={session?.model} text={streaming} />
              </TurnBlock>
            ) : null}

            {permission ? (
              <PermissionCard
                permission={permission}
                pending={permissionPending}
                onRetry={retryCommand}
                onRespond={(response) =>
                  sendCommandOptimistic(
                    {
                      type: "permission.respond",
                      sessionId,
                      permissionId: permission.permissionId,
                      response,
                    },
                    { kind: "permission" },
                  )
                }
              />
            ) : null}
          </>
        )}

        <div ref={streamEndRef} />
      </main>

      <footer className="sticky bottom-0 space-y-2 border-t border-paper-line bg-paper/90 px-4 py-3 backdrop-blur">
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
          <Button
            variant="primary"
            onClick={send}
            disabled={!text.trim() || state.status !== "connected"}
            loading={sendPending?.status === "pending"}
          >
            Send
          </Button>
        </div>
        <Button
          variant="danger"
          className="w-full"
          onClick={abort}
          disabled={!isRunning}
          loading={abortPending?.status === "pending"}
        >
          Stop
        </Button>
        {abortPending?.status === "failed" ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-caption text-error">Stop didn’t go through</span>
            <Button variant="primary" size="sm" onClick={() => retryCommand(abortPending.id)}>
              Retry
            </Button>
          </div>
        ) : null}
      </footer>
    </>
  )
}

/**
 * Local echo of a just-sent prompt (#111). The protocol never echoes the
 * user's own message back, so this is the only place it's ever rendered —
 * it stays in the feed after confirming (just losing its pending dot), it
 * doesn't disappear once real agent activity starts.
 */
function PromptEcho({
  pending,
  onRetry,
}: {
  pending: PendingCommand
  onRetry: (id: string) => void
}) {
  return (
    <div className="space-y-1 text-right">
      <div className="whitespace-pre-wrap text-body leading-relaxed text-text-muted">
        {pending.text}
      </div>
      {pending.status === "pending" ? (
        <div className="flex items-center justify-end gap-1.5 text-caption text-text-muted">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted" />
          Sending…
        </div>
      ) : pending.status === "failed" ? (
        <div className="flex items-center justify-end gap-2">
          <span className="text-caption text-error">Didn’t go through</span>
          <Button variant="primary" size="sm" onClick={() => onRetry(pending.id)}>
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  )
}
