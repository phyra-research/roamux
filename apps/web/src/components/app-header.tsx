"use client"

import { useRelay } from "@/lib/relay-provider"
import Link from "next/link"
import { StatusPill } from "./status-pill"

export function AppHeader({ back }: { back?: { href: string; label: string } }) {
  const { state } = useRelay()
  return (
    <header className="sticky top-0 z-10 border-b border-ink-line bg-ink/80 px-4 py-3 backdrop-blur">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {back ? (
            <Link
              href={back.href}
              className="text-neutral-400 transition-colors hover:text-neutral-100"
              aria-label={back.label}
            >
              ←
            </Link>
          ) : null}
          <Link href="/" className="text-sm font-semibold tracking-wide text-neutral-100">
            OpenRemote
          </Link>
        </div>
        <StatusPill status={state.status} />
      </div>
    </header>
  )
}
