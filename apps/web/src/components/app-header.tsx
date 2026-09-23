"use client"

import { useRelay } from "@/lib/relay-provider"
import Link from "next/link"
import { GitHubStarButton } from "./github-star-button"
import { ReconnectingBanner } from "./reconnecting-banner"
import { StatusPill } from "./status-pill"
import { UserMenu } from "./user-menu"

export function AppHeader({ back }: { back?: { href: string; label: string } }) {
  const { state } = useRelay()
  return (
    <header className="sticky top-0 z-10 border-b border-paper-line bg-paper/80 shadow-sm backdrop-blur">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          {back ? (
            <Link
              href={back.href}
              className="text-text-muted transition-colors hover:text-text"
              aria-label={back.label}
            >
              ←
            </Link>
          ) : null}
          <div className="flex flex-col leading-none">
            <Link href="/" className="text-title font-semibold tracking-wide text-text">
              roamux
            </Link>
            <a
              href="https://phyra.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 text-caption text-text-muted transition-colors hover:text-text"
            >
              by Phyra Research
            </a>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <GitHubStarButton />
          <StatusPill status={state.status} />
          <UserMenu />
        </div>
      </div>
      {/* Part of the sticky header itself (#112) — not the page body — so it
          stays visible while scrolled instead of scrolling away exactly when
          it matters most. */}
      <ReconnectingBanner />
    </header>
  )
}
