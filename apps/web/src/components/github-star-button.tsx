"use client"

import { Badge } from "@/components/ui/badge"
import { useEffect, useState } from "react"

const REPO_URL = "https://github.com/phyra-research/roamux"

function formatStars(n: number): string {
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
}

/**
 * Star count comes from our own /api/github-stars (server-cached there),
 * never api.github.com directly — keeps every visitor's browser off
 * GitHub's unauthenticated rate limit entirely. Adaptive display: shows
 * icon + "Star" until a count loads (or the fetch fails), then icon +
 * count badge — the count already implies "GitHub stars," so dropping the
 * word once it's there keeps this compact at 390px.
 */
export function GitHubStarButton() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    fetch("/api/github-stars")
      .then((r) => r.json())
      .then((body) => {
        if (live && body?.ok && typeof body.data?.count === "number") setCount(body.data.count)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-caption text-text-muted transition-colors hover:text-accent-hover"
      aria-label="Star roamux on GitHub"
    >
      <GitHubMark className="h-4 w-4 shrink-0" />
      {count !== null ? <Badge status="offline">{formatStars(count)}</Badge> : <span>Star</span>}
    </a>
  )
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      <title>GitHub</title>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}
