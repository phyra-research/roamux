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
    <section className="rounded-xl border border-paper-line bg-paper-surface">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="text-body font-medium text-text">
          Changes{hasLoaded && !error ? ` · ${files.length}` : ""}
        </span>
        <span className="flex items-center gap-2 text-caption">
          {hasLoaded && !error && files.length > 0 ? (
            <span className="font-mono">
              <span className="text-success">+{totalAdd}</span>{" "}
              <span className="text-error">−{totalDel}</span>
            </span>
          ) : null}
          <span className="text-text-muted">{open ? "▾" : "▸"}</span>
        </span>
      </button>

      {open ? (
        <div className="border-t border-paper-line px-3 py-2">
          {hasLoaded && !error ? (
            <p className="pb-2 text-caption text-text-muted">
              Uncommitted changes in this project (working tree vs. last commit).
            </p>
          ) : null}
          {loading && !hasLoaded ? (
            <p className="py-2 text-caption text-text-muted">Loading changes…</p>
          ) : error ? (
            <div className="space-y-2 py-1">
              <p className="text-caption text-error">{error}</p>
              <RefreshButton onClick={request} loading={loading} connected={connected} />
            </div>
          ) : files.length === 0 ? (
            <div className="space-y-2 py-1">
              <p className="py-2 text-caption text-text-muted">No uncommitted changes.</p>
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
      className="text-caption text-text-muted underline underline-offset-2 disabled:no-underline disabled:opacity-50"
    >
      {loading ? "Refreshing…" : !connected ? "Disconnected" : "Refresh"}
    </button>
  )
}

// Non-text UI (status dots, 3:1 bar) — `modified` is neutral, not amber,
// per the design principle: green/red carry semantic meaning only, and a
// modified file isn't a warning.
const STATUS_DOT: Record<ChangedFile["status"], string> = {
  added: "bg-success",
  modified: "bg-text-muted",
  deleted: "bg-error",
}

function FileRow({ file }: { file: ChangedFile }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="overflow-hidden rounded-lg border border-paper-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
        aria-expanded={open}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[file.status]}`} />
        <span className="min-w-0 flex-1 truncate font-mono text-caption text-text">
          {file.path}
        </span>
        <span className="shrink-0 font-mono text-caption">
          <span className="text-success">+{file.additions}</span>{" "}
          <span className="text-error">−{file.deletions}</span>
        </span>
      </button>
      {open ? <Patch text={file.patch} /> : null}
    </li>
  )
}

// Diff lines get a soft background tint, not just colored text — the
// `success`/`error` .tint tokens (tailwind.config.ts) are pre-computed at a
// low enough alpha to keep this text ≥4.5:1 against `paper` specifically
// (the code-block background below), which a naive `/10` opacity modifier
// doesn't reliably clear (see #105's contrast verification).
function lineClass(line: string): string {
  if (line.startsWith("@@")) return "bg-accent/5 text-accent"
  if (line.startsWith("+")) return "bg-success-tint text-success"
  if (line.startsWith("-")) return "bg-error-tint text-error"
  if (line.startsWith("\\")) return "text-text-muted"
  return "text-text"
}

function Patch({ text }: { text: string }) {
  if (!text.trim()) {
    return <p className="px-2.5 py-2 text-caption text-text-muted">(no textual diff)</p>
  }
  // Drop the trailing "" from the final newline so we don't render a blank row.
  const lines = text.replace(/\n$/, "").split("\n")
  return (
    <pre className="overflow-x-auto border-t border-paper-line bg-paper px-2.5 py-2 text-caption leading-relaxed">
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: patch lines are static + order-stable
        <div key={i} className={`whitespace-pre px-1 font-mono ${lineClass(line)}`}>
          {line || " "}
        </div>
      ))}
    </pre>
  )
}
