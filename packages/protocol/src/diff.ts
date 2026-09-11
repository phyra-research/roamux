import { z } from "zod"

/**
 * A normalized view of the files an agent changed in a session. Runtime-agnostic:
 * every harness maps its native diff/VCS output down to this shape inside its
 * adapter, so no OpenCode (or other runtime) type ever reaches the wire.
 */

export const ChangedFileSchema = z.object({
  /** Repo-relative path. */
  path: z.string(),
  status: z.enum(["added", "modified", "deleted"]),
  /** Unified-diff text for this file (git-style `--- / +++ / @@` hunks). */
  patch: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
})
export type ChangedFile = z.infer<typeof ChangedFileSchema>

export const DiffSnapshotSchema = z.object({
  files: z.array(ChangedFileSchema),
})
export type DiffSnapshot = z.infer<typeof DiffSnapshotSchema>
