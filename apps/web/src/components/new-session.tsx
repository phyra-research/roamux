"use client"

import { useRelay } from "@/lib/relay-provider"
import { useEffect, useState } from "react"

/**
 * New Session flow (Beta §3.2): pick an approved project + an agent (harness),
 * type an initial instruction, and Start. Sends `session.create` with a
 * projectId + harnessType — never a path. Populated from the host's
 * `projects.snapshot` (requested via `projects.list` on open).
 */
export function NewSession({ onClose }: { onClose: () => void }) {
  const { state, sendCommand } = useRelay()
  const caps = state.capabilities
  const [projectId, setProjectId] = useState("")
  const [harnessType, setHarnessType] = useState("")
  const [prompt, setPrompt] = useState("")
  const [starting, setStarting] = useState(false)

  // Ask the host for its projects + harnesses when this opens.
  useEffect(() => {
    if (state.status === "connected") sendCommand({ type: "projects.list" })
  }, [state.status, sendCommand])

  // Default the pickers once capabilities arrive.
  useEffect(() => {
    if (caps?.projects[0] && !projectId) setProjectId(caps.projects[0].id)
    if (caps?.harnesses[0] && !harnessType) setHarnessType(caps.harnesses[0].id)
  }, [caps, projectId, harnessType])

  const ready = projectId && harnessType && !starting

  function start() {
    if (!ready) return
    setStarting(true)
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
    <div className="space-y-4 rounded-xl border border-ink-line bg-ink-soft p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-100">New session</h3>
        <button type="button" onClick={onClose} className="text-xs text-neutral-500">
          Cancel
        </button>
      </div>

      {!caps ? (
        <div className="space-y-2 text-sm text-neutral-500">
          <p>Loading projects…</p>
          {/* Diagnostics: surface the live connection state so we can see where
              this is stuck (connecting vs connected-but-no-reply). */}
          <p className="text-xs text-neutral-600">
            connection: <span className="text-neutral-400">{state.status}</span> · machines:{" "}
            <span className="text-neutral-400">{state.hosts.length}</span>
          </p>
          <button
            type="button"
            onClick={() => sendCommand({ type: "projects.list" })}
            className="rounded-lg border border-ink-line px-2.5 py-1 text-xs text-neutral-400"
          >
            Retry
          </button>
        </div>
      ) : caps.projects.length === 0 || caps.harnesses.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No approved projects or installed agents on this host yet.
        </p>
      ) : (
        <>
          <Field label="Project">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full rounded-lg border border-ink-line bg-black/30 px-3 py-2 text-sm text-neutral-100"
            >
              {caps.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Agent">
            <select
              value={harnessType}
              onChange={(e) => setHarnessType(e.target.value)}
              className="w-full rounded-lg border border-ink-line bg-black/30 px-3 py-2 text-sm text-neutral-100"
            >
              {caps.harnesses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.displayName}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Task">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should the agent do?"
              rows={3}
              className="w-full resize-none rounded-lg border border-ink-line bg-black/30 px-3 py-2 text-sm text-neutral-100 outline-none"
            />
          </Field>

          <button
            type="button"
            onClick={start}
            disabled={!ready}
            className="w-full rounded-xl bg-emerald-500/15 px-4 py-2.5 text-sm font-medium text-emerald-300 transition-colors active:bg-emerald-500/25 disabled:opacity-50"
          >
            {starting ? "Starting…" : "Start Agent"}
          </button>
        </>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block space-y-1">
      <span className="text-xs uppercase tracking-wider text-neutral-500">{label}</span>
      {children}
    </div>
  )
}
