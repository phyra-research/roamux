"use client"

import { useDiff } from "@/lib/use-diff"
import type { ChangedFile } from "@openremote/protocol"
import { useState } from "react"

/**
 * Mobile-first "Changes" panel: the project's uncommitted changes (working tree
 * vs. the last commit — the same set `git status` shows), each file expandable to
 * its unified-diff patch. Collapsed by default; the first expand fires the
 * diff.request so we don't hit the host for every view.
 */
export function DiffView({ sessionId }: { sessionId: string }) {
  const { files, error, loading, hasLoaded, connected, request } = useDiff(sessionId)
  const [open, setOpen] = useState(false)

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !hasLoaded && !loading) request()
  }

  const totalAdd = files.reduce((n, f) => n + f.additions, 0)
  const totalDel = files.reduce((n, f) => n + f.deletions, 0)

  return (
    <section className="rounded-xl border border-ink-line bg-ink-soft">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-medium text-neutral-200">
          Changes{hasLoaded && !error ? ` · ${files.length}` : ""}
        </span>
        <span className="flex items-center gap-2 text-xs">
          {hasLoaded && !error && files.length > 0 ? (
            <span className="font-mono">
              <span className="text-emerald-400">+{totalAdd}</span>{" "}
              <span className="text-red-400">−{totalDel}</span>
            </span>
          ) : null}
          <span className="text-neutral-500">{open ? "▾" : "▸"}</span>
        </span>
      </button>

      {open ? (
        <div className="border-t border-ink-line px-3 py-2">
          {hasLoaded && !error ? (
            <p className="pb-2 text-[11px] text-neutral-600">
              Uncommitted changes in this project (working tree vs. last commit).
            </p>
          ) : null}
          {loading && !hasLoaded ? (
            <p className="py-2 text-xs text-neutral-500">Loading changes…</p>
          ) : error ? (
            <div className="space-y-2 py-1">
              <p className="text-xs text-red-400">{error}</p>
              <RefreshButton onClick={request} loading={loading} connected={connected} />
            </div>
          ) : files.length === 0 ? (
            <div className="space-y-2 py-1">
              <p className="py-2 text-xs text-neutral-500">No uncommitted changes.</p>
              <RefreshButton onClick={request} loading={loading} connected={connected} />
            </div>
          ) : (
            <div className="space-y-2">
              <ul className="space-y-1">
                {files.map((f) => (
                  <FileRow key={f.path} file={f} />
                ))}
              </ul>
              <RefreshButton onClick={request} loading={loading} connected={connected} />
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}

function RefreshButton({
  onClick,
  loading,
  connected,
}: {
  onClick: () => void
  loading: boolean
  connected: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || !connected}
      className="text-xs text-neutral-500 underline underline-offset-2 disabled:no-underline disabled:opacity-50"
    >
      {loading ? "Refreshing…" : !connected ? "Disconnected" : "Refresh"}
    </button>
  )
}

const STATUS_DOT: Record<ChangedFile["status"], string> = {
  added: "bg-emerald-400",
  modified: "bg-amber-400",
  deleted: "bg-red-400",
}

function FileRow({ file }: { file: ChangedFile }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="overflow-hidden rounded-lg border border-ink-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
        aria-expanded={open}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[file.status]}`} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-200">
          {file.path}
        </span>
        <span className="shrink-0 font-mono text-[11px]">
          <span className="text-emerald-400">+{file.additions}</span>{" "}
          <span className="text-red-400">−{file.deletions}</span>
        </span>
      </button>
      {open ? <Patch text={file.patch} /> : null}
    </li>
  )
}

function lineClass(line: string): string {
  if (line.startsWith("@@")) return "text-sky-400"
  if (line.startsWith("+")) return "text-emerald-300"
  if (line.startsWith("-")) return "text-red-300"
  if (line.startsWith("\\")) return "text-neutral-600"
  return "text-neutral-400"
}

function Patch({ text }: { text: string }) {
  if (!text.trim()) {
    return <p className="px-2.5 py-2 text-[11px] text-neutral-600">(no textual diff)</p>
  }
  // Drop the trailing "" from the final newline so we don't render a blank row.
  const lines = text.replace(/\n$/, "").split("\n")
  return (
    <pre className="overflow-x-auto border-t border-ink-line bg-ink px-2.5 py-2 text-[11px] leading-relaxed">
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: patch lines are static + order-stable
        <div key={i} className={`whitespace-pre font-mono ${lineClass(line)}`}>
          {line || " "}
        </div>
      ))}
    </pre>
  )
}
