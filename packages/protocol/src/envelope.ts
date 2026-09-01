import { z } from "zod"
import { RemoteCommandSchema } from "./commands.js"
import { AgentEventSchema } from "./events.js"
import { AgentSessionSchema, HostInfoSchema } from "./session.js"

export const PROTOCOL_VERSION = 1 as const

/**
 * Every payload on the wire is wrapped in an Envelope. The `message` field is
 * where the variety lives; everything else is routing/observability metadata.
 *
 * `sequence` is per-session and monotonically increasing for event messages.
 * It is present from day one so reconnection/resume (M3) is a routing change,
 * not a protocol change.
 */
function envelope<T extends z.ZodTypeAny>(message: T) {
  return z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    messageId: z.string(),
    deviceId: z.string(),
    sessionId: z.string().optional(),
    sequence: z.number().int().nonnegative().optional(),
    timestamp: z.number(),
    message,
  })
}

// ── Direction: client → relay → host ────────────────────────────────────────

/** Client authenticates/associates itself with a host using a pairing token. */
const ClientHelloSchema = z.object({
  kind: z.literal("client.hello"),
  token: z.string(),
})

/** A remote-control command targeted at a host. */
const CommandMessageSchema = z.object({
  kind: z.literal("command"),
  command: RemoteCommandSchema,
})

export const ClientToRelaySchema = z.discriminatedUnion("kind", [
  ClientHelloSchema,
  CommandMessageSchema,
])

// ── Direction: host → relay → client ────────────────────────────────────────

/** Host registers itself and its pairing token with the relay. */
const HostHelloSchema = z.object({
  kind: z.literal("host.hello"),
  token: z.string(),
  info: HostInfoSchema,
})

/** A normalized agent event for a specific session. */
const EventMessageSchema = z.object({
  kind: z.literal("event"),
  event: AgentEventSchema,
})

/** Full snapshot of the host's sessions (sent on connect and on demand). */
const SessionsSnapshotSchema = z.object({
  kind: z.literal("sessions.snapshot"),
  sessions: z.array(AgentSessionSchema),
})

/** Host presence/identity update. */
const HostStateSchema = z.object({
  kind: z.literal("host.state"),
  info: HostInfoSchema,
})

export const HostToRelaySchema = z.discriminatedUnion("kind", [
  HostHelloSchema,
  EventMessageSchema,
  SessionsSnapshotSchema,
  HostStateSchema,
])

// ── Direction: relay → client (server-originated control) ────────────────────

/** Relay tells the client whether pairing/association succeeded. */
const AckSchema = z.object({
  kind: z.literal("ack"),
  ok: z.boolean(),
  error: z.string().optional(),
})

/** Relay pushes the set of hosts a client is associated with. */
const HostsListSchema = z.object({
  kind: z.literal("hosts.list"),
  hosts: z.array(HostInfoSchema),
})

/**
 * Everything the client can receive: relay-originated control (ack, hosts.list)
 * plus anything a host emits (events, snapshots, state).
 */
export const RelayToClientSchema = z.discriminatedUnion("kind", [
  AckSchema,
  HostsListSchema,
  EventMessageSchema,
  SessionsSnapshotSchema,
  HostStateSchema,
])

// ── Enveloped wire types ─────────────────────────────────────────────────────

export const ClientToRelayEnvelopeSchema = envelope(ClientToRelaySchema)
export const HostToRelayEnvelopeSchema = envelope(HostToRelaySchema)
export const RelayToClientEnvelopeSchema = envelope(RelayToClientSchema)

export type ClientToRelay = z.infer<typeof ClientToRelaySchema>
export type HostToRelay = z.infer<typeof HostToRelaySchema>
export type RelayToClient = z.infer<typeof RelayToClientSchema>

export type Envelope<T> = {
  protocolVersion: typeof PROTOCOL_VERSION
  messageId: string
  deviceId: string
  sessionId?: string
  sequence?: number
  timestamp: number
  message: T
}

export type ClientToRelayEnvelope = z.infer<typeof ClientToRelayEnvelopeSchema>
export type HostToRelayEnvelope = z.infer<typeof HostToRelayEnvelopeSchema>
export type RelayToClientEnvelope = z.infer<typeof RelayToClientEnvelopeSchema>
