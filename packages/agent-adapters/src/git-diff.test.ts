import { describe, expect, test } from "bun:test"
import type { ChangedFile } from "@openremote/protocol"
import { mergeChangedFiles, parseGitDiff } from "./git-diff.js"

const NAME_STATUS = [
  "M\tREADME.md",
  "D\tgone.txt",
  "A\tadded.txt",
  "R100\told/name.ts\tnew/name.ts",
].join("\n")

const FULL_PATCH = [
  "diff --git a/README.md b/README.md",
  "index 1111111..2222222 100644",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -1,2 +1,2 @@",
  " # Title",
  "-old line",
  "+new line",
  "diff --git a/gone.txt b/gone.txt",
  "deleted file mode 100644",
  "index 3333333..0000000",
  "--- a/gone.txt",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-a",
  "-b",
  "diff --git a/added.txt b/added.txt",
  "new file mode 100644",
  "index 0000000..4444444",
  "--- /dev/null",
  "+++ b/added.txt",
  "@@ -0,0 +1,1 @@",
  "+fresh",
  "diff --git a/old/name.ts b/new/name.ts",
  "similarity index 100%",
  "rename from old/name.ts",
  "rename to new/name.ts",
  "",
].join("\n")

describe("parseGitDiff", () => {
  const files = parseGitDiff(NAME_STATUS, FULL_PATCH, ["untracked.md", "added.txt"], (p) =>
    p === "untracked.md" ? "line1\nline2\n" : null,
  )
  const byPath = new Map(files.map((f) => [f.path, f]))

  test("modified file: status, counts, and its own hunk text", () => {
    const f = byPath.get("README.md")
    expect(f?.status).toBe("modified")
    expect([f?.additions, f?.deletions]).toEqual([1, 1])
    expect(f?.patch).toContain("+new line")
    expect(f?.patch.startsWith("diff --git a/README.md b/README.md")).toBe(true)
  })

  test("deleted file → status deleted, only removals counted", () => {
    const f = byPath.get("gone.txt")
    expect(f?.status).toBe("deleted")
    expect([f?.additions, f?.deletions]).toEqual([0, 2])
  })

  test("new tracked file → status added (from `new file mode`)", () => {
    const f = byPath.get("added.txt")
    expect(f?.status).toBe("added")
    expect(f?.additions).toBe(1)
  })

  test("pure rename block (no ---/+++) still resolves to the new path", () => {
    const f = byPath.get("new/name.ts")
    expect(f?.status).toBe("modified") // R in name-status isn't A or D
    expect([f?.additions, f?.deletions]).toEqual([0, 0])
  })

  test("untracked text file → synthesized added patch", () => {
    const f = byPath.get("untracked.md")
    expect(f?.status).toBe("added")
    expect(f?.additions).toBe(2)
    expect(f?.patch).toBe(
      ["--- /dev/null", "+++ b/untracked.md", "@@ -0,0 +1,2 @@", "+line1", "+line2", ""].join("\n"),
    )
  })

  test("untracked file already covered by the patch is not duplicated", () => {
    expect(files.filter((f) => f.path === "added.txt").length).toBe(1)
  })

  test("untracked binary file (readFile → null) → listed with an empty patch", () => {
    const out = parseGitDiff("", "", ["logo.png"], () => null)
    expect(out).toEqual([
      { path: "logo.png", status: "added", patch: "", additions: 0, deletions: 0 },
    ])
  })

  test("empty inputs → no files", () => {
    expect(parseGitDiff("", "", [], () => null)).toEqual([])
  })
})

describe("mergeChangedFiles", () => {
  const git: ChangedFile[] = [
    { path: "a.ts", status: "modified", patch: "GIT", additions: 1, deletions: 1 },
    { path: "empty.ts", status: "modified", patch: "", additions: 0, deletions: 0 },
  ]
  const oc: ChangedFile[] = [
    { path: "a.ts", status: "modified", patch: "OPENCODE", additions: 9, deletions: 9 },
    { path: "empty.ts", status: "modified", patch: "OC-PATCH", additions: 2, deletions: 0 },
    { path: "c.ts", status: "added", patch: "NEW", additions: 3, deletions: 0 },
  ]
  const merged = mergeChangedFiles(git, oc)
  const byPath = new Map(merged.map((f) => [f.path, f]))

  test("primary (git) wins on a shared path", () => {
    expect(byPath.get("a.ts")?.patch).toBe("GIT")
    expect(byPath.get("a.ts")?.additions).toBe(1)
  })

  test("secondary fills in a patch the primary left empty (keeps primary's counts)", () => {
    expect(byPath.get("empty.ts")?.patch).toBe("OC-PATCH")
    expect(byPath.get("empty.ts")?.additions).toBe(0)
  })

  test("secondary contributes paths the primary lacks", () => {
    expect(byPath.get("c.ts")?.patch).toBe("NEW")
  })
})
