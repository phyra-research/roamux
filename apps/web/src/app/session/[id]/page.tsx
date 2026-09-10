"use client"

import { AppHeader } from "@/components/app-header"
import { DiffView } from "@/components/diff-view"
import { EventLine } from "@/components/event-line"
import { PermissionCard } from "@/components/permission-card"
import { useRelay } from "@/lib/relay-provider"
import { use, useEffect, useRef, useState } from "react"

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
        <div className="text-sm font-medium text-neutral-100">{session?.title ?? sessionId}</div>
        <div className="text-xs text-neutral-500">{session?.model ?? "agent"}</div>
      </div>

      <main className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <DiffView sessionId={sessionId} />

        {timeline.length === 0 && !streaming && !permission ? (
          <div className="py-10 text-center text-sm text-neutral-600">
            No activity yet. Send an instruction below to get started.
          </div>
        ) : null}

        {timeline.map((entry) => (
          <EventLine key={entry.key} event={entry.event} />
        ))}

        {streaming ? (
          <div className="whitespace-pre-wrap rounded-xl bg-ink-soft px-3 py-2 text-sm text-neutral-100">
            {streaming}
            <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-neutral-400 align-middle" />
          </div>
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
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-ink-line bg-ink-soft px-3 py-2.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          />
          <button
            type="button"
            onClick={send}
            disabled={!text.trim() || state.status !== "connected"}
            className="rounded-xl bg-neutral-100 px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-40"
          >
            Send
          </button>
        </div>
        <button
          type="button"
          onClick={() => sendCommand({ type: "session.abort", sessionId })}
          disabled={!isRunning}
          className="w-full rounded-xl border border-red-500/40 py-2.5 text-sm font-medium text-red-300 disabled:opacity-30"
        >
          Stop
        </button>
      </footer>
    </>
  )
}
