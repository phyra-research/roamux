import { describe, expect, test } from "bun:test"
import { makeUnifiedDiff } from "./unified-diff.js"

describe("makeUnifiedDiff", () => {
  test("identical content → empty patch", () => {
    expect(makeUnifiedDiff("a.txt", "x\ny\n", "x\ny\n")).toBe("")
  })

  test("empty → empty → empty patch", () => {
    expect(makeUnifiedDiff("a.txt", "", "")).toBe("")
  })

  test("added file → /dev/null source, all + lines", () => {
    expect(makeUnifiedDiff("new.txt", "", "alpha\nbeta\n")).toBe(
      ["--- /dev/null", "+++ b/new.txt", "@@ -0,0 +1,2 @@", "+alpha", "+beta", ""].join("\n"),
    )
  })

  test("deleted file → /dev/null target, all - lines", () => {
    expect(makeUnifiedDiff("gone.txt", "alpha\nbeta\n", "")).toBe(
      ["--- a/gone.txt", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-alpha", "-beta", ""].join("\n"),
    )
  })

  test("single-line change carries surrounding context", () => {
    const before = "l1\nl2\nl3\nl4\nl5\n"
    const after = "l1\nl2\nCHANGED\nl4\nl5\n"
    expect(makeUnifiedDiff("f.txt", before, after)).toBe(
      [
        "--- a/f.txt",
        "+++ b/f.txt",
        "@@ -1,5 +1,5 @@",
        " l1",
        " l2",
        "-l3",
        "+CHANGED",
        " l4",
        " l5",
        "",
      ].join("\n"),
    )
  })

  test("distant edits produce separate hunks", () => {
    const before = `${Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n")}\n`
    const lines = before.split("\n")
    lines[1] = "line 2 EDITED"
    lines[17] = "line 18 EDITED"
    const after = lines.join("\n")
    const patch = makeUnifiedDiff("big.txt", before, after)
    const hunks = patch.split("\n").filter((l) => l.startsWith("@@ "))
    expect(hunks.length).toBe(2)
    expect(patch).toContain("+line 2 EDITED")
    expect(patch).toContain("+line 18 EDITED")
  })

  test("very long single line with no newlines", () => {
    const before = `${"a".repeat(5000)}`
    const after = `${"a".repeat(2500)}b${"a".repeat(2500)}`
    const patch = makeUnifiedDiff("long.txt", before, after)
    expect(patch).toBe(
      [
        "--- a/long.txt",
        "+++ b/long.txt",
        "@@ -1,1 +1,1 @@",
        `-${before}`,
        "\\ No newline at end of file",
        `+${after}`,
        "\\ No newline at end of file",
        "",
      ].join("\n"),
    )
  })

  test("trailing newline vs no trailing newline is a real change", () => {
    // Same visible content; only the final newline differs.
    const patch = makeUnifiedDiff("nl.txt", "a\nb", "a\nb\n")
    expect(patch).toBe(
      [
        "--- a/nl.txt",
        "+++ b/nl.txt",
        "@@ -1,2 +1,2 @@",
        " a",
        "-b",
        "\\ No newline at end of file",
        "+b",
        "",
      ].join("\n"),
    )
  })

  test("no-trailing-newline file edited elsewhere keeps the marker on both sides", () => {
    const patch = makeUnifiedDiff("nl2.txt", "head\nmid\ntail", "head\nMID\ntail")
    expect(patch).toBe(
      [
        "--- a/nl2.txt",
        "+++ b/nl2.txt",
        "@@ -1,3 +1,3 @@",
        " head",
        "-mid",
        "+MID",
        " tail",
        "\\ No newline at end of file",
        "",
      ].join("\n"),
    )
  })
})
