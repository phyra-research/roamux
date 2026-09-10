import type { AgentEvent, ChangedFile } from "@openremote/protocol"

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
