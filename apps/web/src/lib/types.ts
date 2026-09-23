import type { AgentEvent, ChangedFile, RemoteCommand } from "@openremote/protocol"

/** A single rendered line in a session's live event log. */
export type TimelineEntry = {
  key: string
  sequence?: number
  event: AgentEvent
  at: number
}

/** The latest diff.snapshot for a session, as held in client state. */
export type DiffView = {
  files: ChangedFile[]
  error?: string
  /** When this snapshot landed — also the key the loading hook watches. */
  at: number
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "unpaired"

/** A permission awaiting a user decision, surfaced to the UI. */
export type PendingPermission = {
  sessionId: string
  permissionId: string
  description: string
  tool?: string
}

export type PendingCommandKind = "prompt" | "abort" | "permission"
export type PendingCommandStatus = "pending" | "confirmed" | "failed"

/**
 * A command tracked client-side from the moment it's sent for optimistic UI
 * feedback (#111). The protocol has no per-command ack, so "confirmed" is
 * inferred from existing session state (new events, session status flipping,
 * permission resolution) — never a real server acknowledgement.
 */
export type PendingCommand = {
  id: string
  sessionId: string
  kind: PendingCommandKind
  command: RemoteCommand
  status: PendingCommandStatus
  createdAt: number
  /** Only meaningful for kind "prompt" — the text to echo in the timeline. */
  text?: string
}
