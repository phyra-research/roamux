"use client"

import { useState } from "react"

const INSTALL_CMD = "curl -fsSL https://open-remote-sigma.vercel.app/install.sh | sh"

/**
 * First-run onboarding shown when a signed-in user has no machines yet. Gives
 * the exact, copy-pasteable steps to install the CLI and link a machine.
 */
export function Onboarding() {
  return (
    <div className="space-y-4 rounded-xl border border-ink-line bg-ink-soft p-4">
      <div>
        <h3 className="text-sm font-semibold text-neutral-100">Connect your first machine</h3>
        <p className="mt-1 text-sm text-neutral-500">
          Run these on the computer you want to control. It stays on your machine — this app just
          steers it.
        </p>
      </div>

      <Step n={1} label="Install the CLI">
        <CopyBox text={INSTALL_CMD} />
      </Step>

      <Step n={2} label="Link it to your account">
        <CopyBox text="openremote login" />
        <p className="mt-1 text-xs text-neutral-500">
          Prints a code — approve it in your browser (you’re already signed in).
        </p>
      </Step>

      <Step n={3} label="Start it in your project">
        <CopyBox text={"cd ~/your/project\nopenremote host"} />
        <p className="mt-1 text-xs text-neutral-500">
          Requires{" "}
          <a href="https://opencode.ai" className="underline">
            OpenCode
          </a>{" "}
          installed with a model configured (
          <code className="text-neutral-400">opencode auth login</code>). The CLI tells you if
          anything’s missing.
        </p>
      </Step>

      <p className="text-xs text-neutral-600">
        Your machine will appear here as online. Then create a session and start an agent.
      </p>
    </div>
  )
}

function Step({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/40 text-xs font-medium text-neutral-400">
        {n}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="text-sm font-medium text-neutral-200">{label}</div>
        {children}
      </div>
    </div>
  )
}

function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {},
    )
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="flex w-full items-start justify-between gap-2 rounded-lg border border-ink-line bg-black/40 px-3 py-2 text-left"
    >
      <code className="whitespace-pre-wrap break-all font-mono text-xs text-neutral-300">
        {text}
      </code>
      <span className="shrink-0 text-xs text-neutral-500">{copied ? "copied" : "copy"}</span>
    </button>
  )
}
