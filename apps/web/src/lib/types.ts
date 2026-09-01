import type { AgentEvent } from "@openremote/protocol"

/** A single rendered line in a session's live event log. */
export type TimelineEntry = {
  key: string
  sequence?: number
  event: AgentEvent
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
