"use client"

import { AppHeader } from "@/components/app-header"
import { InstallPrompt } from "@/components/install-prompt"
import { MachinesList } from "@/components/machines-list"
import { useAuth } from "@/lib/use-auth"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

/**
 * Home = the machine list. Sessions live PER HOST — tap a machine to open its
 * sessions and start new ones on it (see /host/[id]). Sessions are never
 * flattened across hosts here.
 */
export default function HomePage() {
  const auth = useAuth()
  const router = useRouter()

  // Auth gate: send unauthenticated visitors to sign in.
  useEffect(() => {
    if (!auth.loading && !auth.signedIn) router.replace("/login")
  }, [auth.loading, auth.signedIn, router])

  if (auth.loading || !auth.signedIn) {
    return (
      <>
        <AppHeader />
        <main className="flex flex-1 items-center justify-center px-6 text-sm text-neutral-500">
          {auth.loading ? "Loading…" : "Redirecting to sign in…"}
        </main>
      </>
    )
  }

  return (
    <>
      <AppHeader />
      <main className="flex-1 px-4 py-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
          Machines
        </h2>
        <InstallPrompt />
        <MachinesList />
      </main>
    </>
  )
}
