"use client"

import { useRelay } from "@/lib/relay-provider"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect } from "react"

function PairInner() {
  const params = useSearchParams()
  const router = useRouter()
  const { pair } = useRelay()

  useEffect(() => {
    const token = params.get("token")
    if (token) {
      pair(token)
      router.replace("/")
    }
  }, [params, pair, router])

  return (
    <div className="flex flex-1 items-center justify-center px-6 text-sm text-neutral-400">
      Pairing…
    </div>
  )
}

export default function PairPage() {
  return (
    <Suspense fallback={null}>
      <PairInner />
    </Suspense>
  )
}
