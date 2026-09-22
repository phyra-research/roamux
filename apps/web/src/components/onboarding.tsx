"use client"

import { Card } from "@/components/ui/card"
import { useState } from "react"

const INSTALL_CMD = "curl -fsSL https://remote.phyra.ai/install.sh | sh"

/**
 * First-run onboarding shown when a signed-in user has no machines yet. Gives
 * the exact, copy-pasteable steps to install the CLI and link a machine.
 */
export function Onboarding() {
  return (
    <Card variant="outlined" className="space-y-4 p-4">
      <div>
        <h3 className="text-title font-semibold text-text">Connect your first machine</h3>
        <p className="mt-1 text-body text-text-muted">
          Run these on the computer you want to control. It stays on your machine — this app just
          steers it.
        </p>
      </div>

      <Step n={1} label="Install the CLI">
        <CopyBox text={INSTALL_CMD} />
      </Step>

      <Step n={2} label="Link it to your account">
        <CopyBox text="roamux login" />
        <p className="mt-1 text-caption text-text-muted">
          Prints a code — approve it in your browser (you’re already signed in).
        </p>
      </Step>

      <Step n={3} label="Start it in your project">
        <CopyBox text={"cd ~/your/project\nroamux host"} />
        <p className="mt-1 text-caption text-text-muted">
          Requires{" "}
          <a href="https://opencode.ai" className="text-text underline">
            OpenCode
          </a>{" "}
          installed with a model configured (<code className="text-text">opencode auth login</code>
          ). The CLI tells you if anything’s missing.
        </p>
      </Step>

      <p className="text-caption text-text-muted">
        Your machine will appear here as online. Then create a session and start an agent.
      </p>
    </Card>
  )
}

function Step({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-paper-line bg-paper text-caption font-medium text-text-muted">
        {n}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="text-body font-medium text-text">{label}</div>
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
      className="flex w-full items-start justify-between gap-2 rounded-lg border border-paper-line bg-paper px-3 py-2 text-left"
    >
      <code className="whitespace-pre-wrap break-all font-mono text-caption text-text">{text}</code>
      <span className="shrink-0 text-caption text-text-muted">{copied ? "copied" : "copy"}</span>
    </button>
  )
}
