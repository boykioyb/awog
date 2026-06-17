// Build a git-style unified diff between two text blobs (line-based) with
// `context` lines of surrounding context per hunk. Pure + dependency-free.
// Used by the Edit/MultiEdit tools (which hold both the before- and after-text)
// to attach a diff to the step detail so the UI renders the change like git.
// The emitted hunk headers (`@@ -a,b +c,d @@`) match exactly what the UI's
// diff parser expects (ui/utils/diff-parse.ts) — no file (`---`/`+++`) header,
// since the step detail shows the path separately.

type Op = { t: 'eq' | 'del' | 'add'; line: string }

// Guard: the LCS table is O(n*m) cells. After trimming the common prefix/suffix
// the changed window is usually tiny, but a pathological far-apart MultiEdit on
// a large file could blow up — fall back to a single replace-all hunk instead.
const LCS_CELL_CAP = 4_000_000

function splitLines(text: string): string[] {
  // A trailing newline yields a final '' element; both sides treat it the same,
  // so it cancels out and never shows as a spurious change.
  return text.split('\n')
}

// Longest-common-subsequence diff over lines → an ordered op list.
function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length
  const m = b.length
  // dp[i][j] = LCS length of a[i..] vs b[j..]. Uint32 rows keep memory bounded.
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: 'eq', line: a[i]! })
      i += 1
      j += 1
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ t: 'del', line: a[i]! })
      i += 1
    } else {
      ops.push({ t: 'add', line: b[j]! })
      j += 1
    }
  }
  while (i < n) ops.push({ t: 'del', line: a[i++]! })
  while (j < m) ops.push({ t: 'add', line: b[j++]! })
  return ops
}

// Fallback when the window is too large for LCS: remove every old line, add
// every new one. Coarser but always correct and cheap.
function replaceAllOps(a: string[], b: string[]): Op[] {
  return [
    ...a.map<Op>((line) => ({ t: 'del', line })),
    ...b.map<Op>((line) => ({ t: 'add', line })),
  ]
}

// Group ops into hunks: a hunk spans a change run plus `context` lines on each
// side; runs separated by ≤ 2*context unchanged lines merge into one hunk.
function hunkRanges(ops: Op[], context: number): [number, number][] {
  const ranges: [number, number][] = []
  const n = ops.length
  let i = 0
  while (i < n) {
    if (ops[i]!.t === 'eq') {
      i += 1
      continue
    }
    const start = Math.max(0, i - context)
    let lastChange = i
    let j = i
    while (j < n) {
      if (ops[j]!.t !== 'eq') {
        lastChange = j
        j += 1
        continue
      }
      let k = j
      while (k < n && ops[k]!.t === 'eq') k += 1
      // Small gap with more changes after → keep extending the same hunk.
      if (k < n && k - j <= context * 2) {
        j = k
        continue
      }
      break
    }
    const end = Math.min(n, lastChange + 1 + context)
    ranges.push([start, end])
    i = end
  }
  return ranges
}

export function buildUnifiedDiff(before: string, after: string, context = 3): string {
  if (before === after) return ''
  const a = splitLines(before)
  const b = splitLines(after)

  // Trim the common prefix/suffix so LCS only runs on the changed window.
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre += 1
  let suf = 0
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  ) {
    suf += 1
  }
  const aMid = a.slice(pre, a.length - suf)
  const bMid = b.slice(pre, b.length - suf)
  const midOps =
    aMid.length * bMid.length > LCS_CELL_CAP ? replaceAllOps(aMid, bMid) : lcsOps(aMid, bMid)

  // Stitch the trimmed prefix/suffix back as unchanged ops so hunk grouping can
  // pull real context lines from them.
  const ops: Op[] = [
    ...a.slice(0, pre).map<Op>((line) => ({ t: 'eq', line })),
    ...midOps,
    ...a.slice(a.length - suf).map<Op>((line) => ({ t: 'eq', line })),
  ]

  const out: string[] = []
  for (const [start, end] of hunkRanges(ops, context)) {
    // Line numbers (1-based) of the first op in the hunk on each side.
    let oldNo = 1
    let newNo = 1
    for (let k = 0; k < start; k += 1) {
      if (ops[k]!.t !== 'add') oldNo += 1
      if (ops[k]!.t !== 'del') newNo += 1
    }
    let oldCount = 0
    let newCount = 0
    const body: string[] = []
    for (let k = start; k < end; k += 1) {
      const op = ops[k]!
      if (op.t === 'eq') {
        oldCount += 1
        newCount += 1
        body.push(` ${op.line}`)
      } else if (op.t === 'del') {
        oldCount += 1
        body.push(`-${op.line}`)
      } else {
        newCount += 1
        body.push(`+${op.line}`)
      }
    }
    out.push(`@@ -${oldNo},${oldCount} +${newNo},${newCount} @@`)
    out.push(...body)
  }
  return out.join('\n')
}
