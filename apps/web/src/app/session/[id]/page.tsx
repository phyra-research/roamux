"use client"

import { AppHeader } from "@/components/app-header"
import { DiffView } from "@/components/diff-view"
import { EventLine } from "@/components/event-line"
import { PermissionCard } from "@/components/permission-card"
import { ToolCallCard, groupTimelineEntries } from "@/components/tool-call"
import { StreamingBox, TurnBlock, groupIntoTurns } from "@/components/turn"
import { Button } from "@/components/ui/button"
import { useRelay } from "@/lib/relay-provider"
import { use, useEffect, useMemo, useRef, useState } from "react"

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const sessionId = decodeURIComponent(id)
  const { state, sendCommand } = useRelay()
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

  // Ask the host for a fresh session list on mount (covers deep links).
  useEffect(() => {
    if (state.status === "connected") sendCommand({ type: "sessions.list" })
  }, [state.status, sendCommand])

  // Auto-scroll to the latest activity.
  const permissionId = permission?.permissionId
  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [timeline.length, streaming, permissionId])

  const send = () => {
    const t = text.trim()
    if (!t) return
    sendCommand({ type: "prompt.send", sessionId, text: t })
    setText("")
  }

  return (
    <>
      <AppHeader back={{ href: "/", label: "Back to machines" }} />

      <div className="border-b border-ink-line px-4 py-3">
        <div className="text-title font-semibold text-neutral-100">
          {session?.title ?? sessionId}
        </div>
        <div className="text-caption text-neutral-500">{session?.model ?? "agent"}</div>
      </div>

      <main className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <DiffView sessionId={sessionId} />

        {timeline.length === 0 && !streaming && !permission ? (
          <div className="py-10 text-center text-body text-neutral-600">
            No activity yet. Send an instruction below to get started.
          </div>
        ) : null}

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

        <div ref={streamEndRef} />
      </main>

      <footer className="sticky bottom-0 space-y-2 border-t border-ink-line bg-ink/90 px-4 py-3 backdrop-blur">
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
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-ink-line bg-ink-soft px-3 py-2.5 text-body text-neutral-100 outline-none focus:border-neutral-500"
          />
          <Button
            variant="primary"
            onClick={send}
            disabled={!text.trim() || state.status !== "connected"}
          >
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
