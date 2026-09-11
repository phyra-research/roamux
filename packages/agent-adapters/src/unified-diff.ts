/**
 * Minimal line-based unified-diff generator.
 *
 * OpenCode's session-diff endpoint returns the *before* and *after* contents of
 * each changed file, not a patch. The wire/UI want a git-style `patch` string, so
 * we synthesize one here (no OpenCode type crosses the adapter boundary). This is
 * an LCS diff — good enough for the handful of lines an agent edit touches — with
 * a hard cell cap so a pathological input can't blow up the host.
 */

type DiffOp = { t: "eq" | "del" | "add"; line: string }
type Split = { lines: string[]; trailingNewline: boolean }

/** Split into lines, remembering whether the file ended with a newline. */
function splitLines(s: string): Split {
  if (s === "") return { lines: [], trailingNewline: false }
  const parts = s.split("\n")
  if (parts[parts.length - 1] === "") {
    parts.pop()
    return { lines: parts, trailingNewline: true }
  }
  return { lines: parts, trailingNewline: false }
}

/** Above this many DP cells we skip the LCS and just replace the file wholesale. */
const MAX_LCS_CELLS = 4_000_000
const NO_NEWLINE = "\\ No newline at end of file"

function diffOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0 || n * m > MAX_LCS_CELLS) {
    return [
      ...a.map((line): DiffOp => ({ t: "del", line })),
      ...b.map((line): DiffOp => ({ t: "add", line })),
    ]
  }
  // Suffix-LCS length table, flattened. `at` clamps the noUncheckedIndexedAccess
  // `| undefined` to 0 — every read here is in-bounds by construction.
  const w = m + 1
  const dp = new Int32Array((n + 1) * w)
  const at = (r: number, c: number): number => dp[r * w + c] ?? 0
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: "eq", line: a[i] as string })
      i++
      j++
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      ops.push({ t: "del", line: a[i] as string })
      i++
    } else {
      ops.push({ t: "add", line: b[j] as string })
      j++
    }
  }
  while (i < n) ops.push({ t: "del", line: a[i++] as string })
  while (j < m) ops.push({ t: "add", line: b[j++] as string })
  return ops
}

/**
 * Build a git-style unified diff for one file. Returns `""` when the contents are
 * identical (including trailing newline).
 */
export function makeUnifiedDiff(path: string, before: string, after: string, context = 3): string {
  if (before === after) return ""
  const a = splitLines(before)
  const b = splitLines(after)
  const ops = diffOps(a.lines, b.lines)

  // A newline-only change leaves every line equal — force the last line to
  // "change" so the `\ No newline` markers still land inside a hunk.
  if (a.trailingNewline !== b.trailingNewline) {
    for (let k = ops.length - 1; k >= 0; k--) {
      if (ops[k]?.t === "eq") {
        const line = ops[k]?.line as string
        ops.splice(k, 1, { t: "del", line }, { t: "add", line })
        break
      }
    }
  }

  if (!ops.some((o) => o.t !== "eq")) return ""

  // Annotate every op with its 1-based line number on each side.
  let aLine = 0
  let bLine = 0
  const ann = ops.map((op) => {
    if (op.t === "eq") return { op, aNo: ++aLine, bNo: ++bLine }
    if (op.t === "del") return { op, aNo: ++aLine, bNo: 0 }
    return { op, aNo: 0, bNo: ++bLine }
  })

  const changed = ann.flatMap((e, idx) => (e.op.t === "eq" ? [] : [idx]))
  // Cluster changed ops whose context windows would touch (within 2*context).
  const clusters: [number, number][] = []
  let clusterStart = changed[0] as number
  let prev = changed[0] as number
  for (let k = 1; k < changed.length; k++) {
    const idx = changed[k] as number
    if (idx - prev > context * 2) {
      clusters.push([clusterStart, prev])
      clusterStart = idx
    }
    prev = idx
  }
  clusters.push([clusterStart, prev])

  const aLen = a.lines.length
  const bLen = b.lines.length
  const out = [
    `--- ${before === "" ? "/dev/null" : `a/${path}`}`,
    `+++ ${after === "" ? "/dev/null" : `b/${path}`}`,
  ]

  for (const [lo, hi] of clusters) {
    const from = Math.max(0, lo - context)
    const to = Math.min(ann.length - 1, hi + context)
    let aStart = 0
    let bStart = 0
    let aCount = 0
    let bCount = 0
    const body: string[] = []
    for (let idx = from; idx <= to; idx++) {
      const { op, aNo, bNo } = ann[idx] as { op: DiffOp; aNo: number; bNo: number }
      if (op.t === "eq") {
        aStart ||= aNo
        bStart ||= bNo
        aCount++
        bCount++
        body.push(` ${op.line}`)
        if (aNo === aLen && bNo === bLen && !a.trailingNewline && !b.trailingNewline) {
          body.push(NO_NEWLINE)
        }
      } else if (op.t === "del") {
        aStart ||= aNo
        aCount++
        body.push(`-${op.line}`)
        if (aNo === aLen && !a.trailingNewline) body.push(NO_NEWLINE)
      } else {
        bStart ||= bNo
        bCount++
        body.push(`+${op.line}`)
        if (bNo === bLen && !b.trailingNewline) body.push(NO_NEWLINE)
      }
    }
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`, ...body)
  }

  return `${out.join("\n")}\n`
}
