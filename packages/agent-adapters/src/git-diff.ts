import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { ChangedFile } from "@openremote/protocol"
import { makeUnifiedDiff } from "./unified-diff.js"

/**
 * Working-tree diff straight from `git`.
 *
 * OpenCode 1.18.x's `session.diff` / `file.status` / `Session.summary` all report
 * zero even for sessions that clearly edited files, so `git` is the authoritative
 * source for "what changed on disk" (matches what a user sees in `git status`).
 *
 * SECURITY: only fixed `git` invocations run here — no shell (`execFileSync` with
 * an argv array), and no client/wire input ever reaches argv (the only variable
 * is the host-configured project directory). `diff.request` stays the sole
 * trigger and is Zod-validated upstream.
 */

const MAX_GIT_FILES = 100

/** Run git in `cwd`. Returns stdout, or null if git failed / this isn't a repo. */
function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
  } catch {
    return null
  }
}

/**
 * The project's uncommitted changes (working tree vs HEAD), untracked files
 * included. `[]` when `cwd` isn't a git work tree or git is unavailable.
 */
export function readGitWorkingTree(cwd: string): ChangedFile[] {
  const root = git(cwd, ["rev-parse", "--show-toplevel"])?.trim()
  if (!root) return []
  const q = ["-c", "core.quotepath=false"]
  const nameStatus = git(root, [...q, "diff", "--name-status", "HEAD"]) ?? ""
  const fullPatch = git(root, [...q, "diff", "HEAD"]) ?? ""
  const untracked = (git(root, ["ls-files", "--others", "--exclude-standard", "-z"]) ?? "")
    .split("\0")
    .filter(Boolean)
  return parseGitDiff(nameStatus, fullPatch, untracked, (p) => safeRead(root, p))
}

function safeRead(root: string, rel: string): string | null {
  const abs = resolve(root, rel)
  if (!abs.startsWith(resolve(root))) return null // never escape the repo root
  try {
    const buf = readFileSync(abs)
    return buf.includes(0) ? null : buf.toString("utf8") // NUL byte → binary → skip
  } catch {
    return null
  }
}

type ReadFile = (path: string) => string | null

/** Pure: `git diff --name-status` + `git diff HEAD` + an untracked list → ChangedFile[]. */
export function parseGitDiff(
  nameStatus: string,
  fullPatch: string,
  untracked: string[],
  readFile: ReadFile,
): ChangedFile[] {
  const statusByPath = new Map<string, ChangedFile["status"]>()
  for (const line of nameStatus.split("\n").filter(Boolean)) {
    const parts = line.split("\t")
    const code = parts[0]?.[0]
    // Rename/copy lines are "R100\told\tnew" — report the new path.
    const path = parts.length >= 3 ? parts[parts.length - 1] : parts[1]
    if (path) {
      statusByPath.set(path, code === "A" ? "added" : code === "D" ? "deleted" : "modified")
    }
  }

  const files: ChangedFile[] = []
  for (const block of splitPatch(fullPatch)) {
    if (!block.path) continue
    files.push({
      path: block.path,
      status:
        statusByPath.get(block.path) ??
        (block.isNew ? "added" : block.isDeleted ? "deleted" : "modified"),
      patch: block.text,
      additions: block.additions,
      deletions: block.deletions,
    })
  }

  const seen = new Set(files.map((f) => f.path))
  for (const path of untracked) {
    if (seen.has(path)) continue
    const content = readFile(path)
    if (content == null) {
      files.push({ path, status: "added", patch: "", additions: 0, deletions: 0 })
      continue
    }
    files.push({
      path,
      status: "added",
      patch: makeUnifiedDiff(path, "", content),
      additions: content === "" ? 0 : content.replace(/\n$/, "").split("\n").length,
      deletions: 0,
    })
  }

  return files.slice(0, MAX_GIT_FILES)
}

type Block = {
  path: string | null
  text: string
  additions: number
  deletions: number
  isNew: boolean
  isDeleted: boolean
}

function splitPatch(full: string): Block[] {
  if (!full.trim()) return []
  return full
    .split(/(?=^diff --git )/m)
    .filter((c) => c.startsWith("diff --git "))
    .map((text) => {
      let path: string | null = null
      let isNew = false
      let isDeleted = false
      let additions = 0
      let deletions = 0
      for (const line of text.split("\n")) {
        if (line.startsWith("+++ ")) {
          const p = line.slice(4)
          if (p !== "/dev/null") path = p.replace(/^b\//, "")
        } else if (line.startsWith("--- ") && !path) {
          const p = line.slice(4)
          if (p !== "/dev/null") path = p.replace(/^a\//, "")
        } else if (line.startsWith("new file mode ")) {
          isNew = true
        } else if (line.startsWith("deleted file mode ")) {
          isDeleted = true
        } else if (line.startsWith("+") && !line.startsWith("+++")) {
          additions++
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          deletions++
        }
      }
      if (!path) {
        // Pure rename / mode-only / binary block — take the path from the header.
        const m = /^diff --git a\/(.+) b\/(.+)$/.exec(text.split("\n")[0] ?? "")
        if (m) path = m[2] ?? null
      }
      return { path, text: text.replace(/\n+$/, "\n"), additions, deletions, isNew, isDeleted }
    })
}

/**
 * Merge two ChangedFile lists by path: `primary` wins; `secondary` only adds
 * paths `primary` doesn't have, or fills in a patch `primary` left empty.
 */
export function mergeChangedFiles(primary: ChangedFile[], secondary: ChangedFile[]): ChangedFile[] {
  const byPath = new Map(primary.map((f) => [f.path, f]))
  for (const f of secondary) {
    const existing = byPath.get(f.path)
    if (!existing) byPath.set(f.path, f)
    else if (!existing.patch && f.patch) byPath.set(f.path, { ...existing, patch: f.patch })
  }
  return [...byPath.values()].slice(0, MAX_GIT_FILES)
}
