"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/cn"
import { useRelay } from "@/lib/relay-provider"
import { useEffect, useState } from "react"

const LAST_PROJECT_KEY_PREFIX = "roamux.lastProject."

// Client-side only (no relay-client.ts / capability-fetch changes): the
// server has no concept of "last used project," so this is purely a local
// convenience, scoped per host since projects are host-specific.
function readLastProject(hostId: string): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(LAST_PROJECT_KEY_PREFIX + hostId)
}
function writeLastProject(hostId: string, projectId: string): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(LAST_PROJECT_KEY_PREFIX + hostId, projectId)
}

/**
 * New Session flow (Beta §3.2): pick an approved project + an agent (harness),
 * type an initial instruction, and Start. Sends `session.create` with a
 * projectId + harnessType — never a path. Populated from the host's
 * `projects.snapshot` (requested via `projects.list` on open).
 */
export function NewSession({ hostId, onClose }: { hostId: string; onClose: () => void }) {
  const { state, sendCommand } = useRelay()
  const caps = state.capabilities
  const [projectId, setProjectId] = useState("")
  const [harnessType, setHarnessType] = useState("")
  const [prompt, setPrompt] = useState("")
  const [starting, setStarting] = useState(false)

  // Ask the host for its projects + harnesses. Keep asking (every 1.5s) until
  // they arrive — robust against connection-timing races: the send is a no-op
  // when not yet connected, and once the account channel is up the host replies.
  useEffect(() => {
    if (caps) return
    sendCommand({ type: "projects.list" })
    const t = setInterval(() => sendCommand({ type: "projects.list" }), 1500)
    return () => clearInterval(t)
  }, [caps, sendCommand])

  // Default the pickers once capabilities arrive: the last project used on
  // this host, if it's still offered, else the first one; the first (usually
  // only) harness.
  useEffect(() => {
    const firstProject = caps?.projects[0]
    if (firstProject && !projectId) {
      const last = readLastProject(hostId)
      const stillOffered = last ? caps.projects.some((p) => p.id === last) : false
      setProjectId(stillOffered && last ? last : firstProject.id)
    }
    const firstHarness = caps?.harnesses[0]
    if (firstHarness && !harnessType) setHarnessType(firstHarness.id)
  }, [caps, projectId, harnessType, hostId])

  const ready = projectId && harnessType && !starting

  function start() {
    if (!ready) return
    setStarting(true)
    writeLastProject(hostId, projectId)
    sendCommand({
      type: "session.create",
      projectId,
      harnessType,
      ...(prompt.trim() ? { initialPrompt: prompt.trim() } : {}),
    })
    // The host replies with a fresh sessions snapshot; close and let the list update.
    setTimeout(onClose, 400)
  }

  return (
    <Card variant="outlined" className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-title font-semibold text-neutral-100">New session</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>

      {!caps ? (
        <div className="space-y-4">
          <div className="space-y-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
          <div className="space-y-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-xl" />
          {/* Diagnostics: surface the live connection state so we can see where
              this is stuck (connecting vs connected-but-no-reply). */}
          <p className="text-caption text-neutral-600">
            connection: <span className="text-neutral-400">{state.status}</span> · machines:{" "}
            <span className="text-neutral-400">{state.hosts.length}</span>
          </p>
          <button
            type="button"
            onClick={() => sendCommand({ type: "projects.list" })}
            className="rounded-lg border border-ink-line px-2.5 py-1 text-caption text-neutral-400"
          >
            Retry
          </button>
        </div>
      ) : caps.projects.length === 0 || caps.harnesses.length === 0 ? (
        <p className="text-body text-neutral-500">
          No approved projects or installed agents on this host yet.
        </p>
      ) : (
        <>
          <Field label="Project">
            <OptionList
              options={caps.projects.map((p) => ({ id: p.id, label: p.label }))}
              selected={projectId}
              onSelect={setProjectId}
            />
          </Field>

          <Field label="Agent">
            {caps.harnesses.length === 1 ? (
              // Nothing to choose — shown as the same "selected" chip an
              // OptionList would render, not a picker.
              <div className="rounded-xl border border-accent-bright bg-accent/10 px-3 py-2.5 text-body text-neutral-100">
                {caps.harnesses[0].displayName}
              </div>
            ) : (
              <OptionList
                options={caps.harnesses.map((h) => ({ id: h.id, label: h.displayName }))}
                selected={harnessType}
                onSelect={setHarnessType}
              />
            )}
          </Field>

          <Field label="Task">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should the agent do?"
              rows={3}
              className="w-full resize-none rounded-lg border border-ink-line bg-black/30 px-3 py-2 text-body text-neutral-100 outline-none"
            />
          </Field>

          <Button
            variant="primary"
            className="w-full"
            onClick={start}
            disabled={!ready}
            loading={starting}
          >
            {starting ? "Starting…" : "Start Agent"}
          </Button>
        </>
      )}
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block space-y-1.5">
      <span className="text-caption uppercase tracking-wider text-neutral-500">{label}</span>
      {children}
    </div>
  )
}

/**
 * A tappable list of options — the selected one gets an indigo border/tint
 * (a UI-selection indicator, not a semantic claim) so the current choice
 * stays visible, unlike a closed <select>.
 */
function OptionList({
  options,
  selected,
  onSelect,
}: {
  options: Array<{ id: string; label: string }>
  selected: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="space-y-1.5">
      {options.map((opt) => {
        const active = opt.id === selected
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onSelect(opt.id)}
            aria-pressed={active}
            className={cn(
              "w-full truncate rounded-xl border px-3 py-2.5 text-left text-body transition-colors",
              active
                ? "border-accent-bright bg-accent/10 text-neutral-100"
                : "border-ink-line bg-ink-soft text-neutral-300 active:bg-ink-line",
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
