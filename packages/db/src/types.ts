import { z } from "zod"

/**
 * Row shapes for the control-plane tables, validated with Zod at the DB
 * boundary (same discipline as the protocol: parse at every trust boundary).
 * These mirror migrations/0001_init.sql.
 */

export const UserRow = z.object({
  id: z.string().uuid(),
  authSubject: z.string().uuid().nullable(),
  email: z.string().nullable(),
  createdAt: z.date(),
})
export type UserRow = z.infer<typeof UserRow>

export const HostStatus = z.enum(["online", "offline", "degraded"])
export type HostStatus = z.infer<typeof HostStatus>

export const HostRow = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  platform: z.string().nullable(),
  daemonVersion: z.string().nullable(),
  capabilities: z.record(z.unknown()),
  status: HostStatus,
  lastSeenAt: z.date().nullable(),
  createdAt: z.date(),
  revokedAt: z.date().nullable(),
})
export type HostRow = z.infer<typeof HostRow>

export const HostProjectRow = z.object({
  id: z.string().uuid(),
  hostId: z.string().uuid(),
  displayLabel: z.string(),
  status: z.string(),
  createdAt: z.date(),
})
export type HostProjectRow = z.infer<typeof HostProjectRow>
