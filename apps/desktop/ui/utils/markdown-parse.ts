// Pure markdown parser cho MarkdownRenderer.
//
// Parser cố ý đơn giản (subset markdown) và pure — không Vue, không reactive,
// không DOM. Render layer (`components/MarkdownRenderer.vue`) tiêu thụ AST này.
//
// Subset hỗ trợ:
// - Heading h1..h6 (`#`..`######`; h4+ render như h3)
// - Code fence ```lang ... ``` (lang = `mermaid` → block type riêng)
// - Bullet list (`-`/`*`), ordered list (`\d+.`) — có lồng cấp theo thụt lề + dòng nối tiếp
// - Bảng GFM (`| a | b |` + dòng phân cách `|---|---|`, hỗ trợ canh lề `:--`/`--:`)
// - Horizontal rule (`---`, `***`, `___`)
// - Blockquote (`>`)
// - Empty line (spacer)
// - Paragraph
// Inline: **bold**, *italic*, `code`, [text](href).

export type InlinePart =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string }

// A list entry: its own inline content plus any nested sub-lists (children).
export type ListItem = { parts: InlinePart[]; children: Block[] }

// Per-column text alignment from a GFM table separator (`:--`, `--:`, `:--:`).
export type TableAlign = 'left' | 'center' | 'right' | null

export type Block =
  | { type: 'mermaid'; code: string }
  | { type: 'code'; lang: string; code: string }
  | { type: 'h1' | 'h2' | 'h3'; parts: InlinePart[] }
  | { type: 'ul' | 'ol'; items: ListItem[] }
  | { type: 'blockquote'; parts: InlinePart[] }
  | { type: 'table'; headers: InlinePart[][]; aligns: TableAlign[]; rows: InlinePart[][][] }
  | { type: 'hr' }
  | { type: 'empty' }
  | { type: 'p'; parts: InlinePart[] }

type InlineMatch = {
  match: RegExpMatchArray
  type: 'bold' | 'italic' | 'code' | 'link'
  idx: number
}

// Parse inline markup trong một dòng text.
export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = []
  let remaining = text
  while (remaining.length > 0) {
    const boldMatch = remaining.match(/^(.*?)\*\*([^*]+)\*\*/)
    const italicMatch = remaining.match(/^(.*?)\*([^*]+)\*/)
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`/)
    const linkMatch = remaining.match(/^(.*?)\[([^\]]+)\]\(([^)]+)\)/)

    const candidates: InlineMatch[] = []
    if (boldMatch && boldMatch[1] !== undefined) {
      candidates.push({ match: boldMatch, type: 'bold', idx: boldMatch[1].length })
    }
    if (italicMatch && italicMatch[1] !== undefined) {
      candidates.push({ match: italicMatch, type: 'italic', idx: italicMatch[1].length })
    }
    if (codeMatch && codeMatch[1] !== undefined) {
      candidates.push({ match: codeMatch, type: 'code', idx: codeMatch[1].length })
    }
    if (linkMatch && linkMatch[1] !== undefined) {
      candidates.push({ match: linkMatch, type: 'link', idx: linkMatch[1].length })
    }
    candidates.sort((a, b) => a.idx - b.idx)

    const first = candidates[0]
    if (!first) {
      parts.push({ type: 'text', text: remaining })
      break
    }

    if (first.idx > 0) parts.push({ type: 'text', text: remaining.slice(0, first.idx) })

    if (first.type === 'link') {
      const linkText = first.match[2] ?? ''
      const href = first.match[3] ?? ''
      parts.push({ type: 'link', text: linkText, href })
      remaining = remaining.slice(first.idx + linkText.length + href.length + 4)
    } else {
      const inner = first.match[2] ?? ''
      parts.push({ type: first.type, text: inner })
      const wrapLen = first.type === 'bold' ? 4 : 2
      remaining = remaining.slice(first.idx + inner.length + wrapLen)
    }
  }
  return parts
}

// A list-item line: leading indent + marker (`-`/`*` or `\d+.`) + content.
const LIST_ITEM_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/
// A horizontal rule: a line of 3+ of the same `-`/`*`/`_` (optional spaces between).
const HR_RE = /^\s*([-*_])(?:\s*\1){2,}\s*$/

const last = (items: ListItem[]): ListItem | undefined => items[items.length - 1]

// Split a table row into trimmed cell strings (edge pipes optional).
const splitTableRow = (line: string): string[] => {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

// A GFM table separator row: only `| - :` and spaces, has a pipe + a dash.
const isTableSeparator = (line: string): boolean => {
  const s = line.trim()
  return s.includes('|') && s.includes('-') && /^[\s|:-]+$/.test(s)
}

const cellAlign = (cell: string): TableAlign => {
  const c = cell.trim()
  const l = c.startsWith(':')
  const r = c.endsWith(':')
  if (l && r) return 'center'
  if (r) return 'right'
  if (l) return 'left'
  return null
}

// Parse a (possibly nested) list starting at `lines[start]`. Items indented
// deeper than this list's marker become a nested sub-list under the previous
// item; non-list indented lines are continuation text joined to the last item.
// Returns the list block and the index of the first line it did NOT consume.
function parseList(lines: string[], start: number): { block: Block; next: number } {
  const first = lines[start]?.match(LIST_ITEM_RE)
  const indent = first?.[1]?.length ?? 0
  const ordered = (first?.[2] ?? '').includes('.')
  const items: ListItem[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const m = line.match(LIST_ITEM_RE)
    if (m) {
      const itemIndent = (m[1] ?? '').length
      if (itemIndent < indent) break // a shallower item belongs to an outer list
      const parent = last(items)
      if (itemIndent > indent && parent) {
        const nested = parseList(lines, i)
        parent.children.push(nested.block)
        i = nested.next
        continue
      }
      // Same level: a marker-type switch (bullet ↔ number) starts a new list.
      if ((m[2] ?? '').includes('.') !== ordered) break
      items.push({ parts: parseInline(m[3] ?? ''), children: [] })
      i += 1
      continue
    }
    // Indented non-list line → continuation of the current item (wrapped text).
    const tail = last(items)
    if (line.trim() !== '' && /^\s/.test(line) && tail) {
      tail.parts.push({ type: 'text', text: ' ' }, ...parseInline(line.trim()))
      i += 1
      continue
    }
    break // blank line or unindented non-list line ends the list
  }
  return { block: { type: ordered ? 'ol' : 'ul', items }, next: i }
}

// Parse markdown source thành AST blocks.
export function parseMarkdown(src: string): Block[] {
  const lines = src.split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''

    // Code fence
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        codeLines.push(lines[i] ?? '')
        i += 1
      }
      const codeContent = codeLines.join('\n')
      if (lang === 'mermaid') out.push({ type: 'mermaid', code: codeContent })
      else out.push({ type: 'code', lang, code: codeContent })
      i += 1
      continue
    }

    // Heading h1..h6 — deeper levels collapse to h3 (renderer only styles 3).
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = Math.min((heading[1] ?? '').length, 3)
      out.push({ type: `h${level}` as 'h1' | 'h2' | 'h3', parts: parseInline(heading[2] ?? '') })
      i += 1
      continue
    }

    // Horizontal rule — checked before lists so `- - -` isn't read as a bullet.
    if (HR_RE.test(line)) {
      out.push({ type: 'hr' })
      i += 1
      continue
    }

    if (LIST_ITEM_RE.test(line)) {
      const { block, next } = parseList(lines, i)
      out.push(block)
      i = next
      continue
    }

    // GFM table: a `| ... |` header row immediately followed by a |---| separator.
    if (line.includes('|') && isTableSeparator(lines[i + 1] ?? '')) {
      const headers = splitTableRow(line).map(parseInline)
      const aligns = splitTableRow(lines[i + 1] ?? '').map(cellAlign)
      i += 2
      const rows: InlinePart[][][] = []
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim() !== '') {
        rows.push(splitTableRow(lines[i] ?? '').map(parseInline))
        i += 1
      }
      out.push({ type: 'table', headers, aligns, rows })
      continue
    }

    if (line.startsWith('> ')) {
      out.push({ type: 'blockquote', parts: parseInline(line.slice(2)) })
      i += 1
      continue
    }

    if (line.trim() === '') {
      out.push({ type: 'empty' })
      i += 1
      continue
    }

    out.push({ type: 'p', parts: parseInline(line) })
    i += 1
  }
  return out
}
