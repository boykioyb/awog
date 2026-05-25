export type DiffLineKind = 'context' | 'add' | 'del' | 'meta' | 'hunk' | 'empty'

export interface SideRow {
  left: { lineNo: number | null; content: string; kind: DiffLineKind }
  right: { lineNo: number | null; content: string; kind: DiffLineKind }
}

interface Hunk {
  oldStart: number
  newStart: number
  header: string
  lines: { content: string; sign: ' ' | '+' | '-' }[]
}

const parseHunkHeader = (line: string) => {
  const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
  if (!m) return null
  return { oldStart: parseInt(m[1] ?? '1', 10), newStart: parseInt(m[2] ?? '1', 10) }
}

const splitHunks = (content: string): { meta: string[]; hunks: Hunk[] } => {
  const lines = content.split('\n')
  const meta: string[] = []
  const hunks: Hunk[] = []
  let i = 0
  while (i < lines.length && !lines[i]!.startsWith('@@')) {
    meta.push(lines[i]!)
    i += 1
  }
  while (i < lines.length) {
    const header = lines[i]!
    const parsed = parseHunkHeader(header)
    if (!parsed) {
      i += 1
      continue
    }
    i += 1
    const body: Hunk['lines'] = []
    while (i < lines.length && !lines[i]!.startsWith('@@')) {
      const ln = lines[i]!
      if (ln.startsWith('+') && !ln.startsWith('+++')) {
        body.push({ content: ln.slice(1), sign: '+' })
      } else if (ln.startsWith('-') && !ln.startsWith('---')) {
        body.push({ content: ln.slice(1), sign: '-' })
      } else if (ln.startsWith(' ')) {
        body.push({ content: ln.slice(1), sign: ' ' })
      } else if (ln === '') {
        body.push({ content: '', sign: ' ' })
      }
      i += 1
    }
    hunks.push({ ...parsed, header, lines: body })
  }
  return { meta, hunks }
}

export interface SideDiff {
  meta: string[]
  groups: { header: string; rows: SideRow[] }[]
}

const empty: SideRow['left'] = { lineNo: null, content: '', kind: 'empty' }

export const buildSideDiff = (content: string): SideDiff => {
  const { meta, hunks } = splitHunks(content)
  const groups = hunks.map((h) => {
    const rows: SideRow[] = []
    let oldLine = h.oldStart
    let newLine = h.newStart
    let i = 0
    while (i < h.lines.length) {
      const ln = h.lines[i]!
      if (ln.sign === ' ') {
        rows.push({
          left: { lineNo: oldLine, content: ln.content, kind: 'context' },
          right: { lineNo: newLine, content: ln.content, kind: 'context' },
        })
        oldLine += 1
        newLine += 1
        i += 1
        continue
      }
      // collect consecutive '-' then '+'
      const dels: string[] = []
      const adds: string[] = []
      while (i < h.lines.length && h.lines[i]!.sign === '-') {
        dels.push(h.lines[i]!.content)
        i += 1
      }
      while (i < h.lines.length && h.lines[i]!.sign === '+') {
        adds.push(h.lines[i]!.content)
        i += 1
      }
      const max = Math.max(dels.length, adds.length)
      for (let k = 0; k < max; k += 1) {
        const hasDel = k < dels.length
        const hasAdd = k < adds.length
        rows.push({
          left: hasDel ? { lineNo: oldLine + k, content: dels[k]!, kind: 'del' } : { ...empty },
          right: hasAdd ? { lineNo: newLine + k, content: adds[k]!, kind: 'add' } : { ...empty },
        })
      }
      oldLine += dels.length
      newLine += adds.length
    }
    return { header: h.header, rows }
  })
  return { meta, groups }
}
