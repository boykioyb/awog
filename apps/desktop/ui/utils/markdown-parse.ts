// Pure markdown parser cho MarkdownRenderer.
//
// Parser cố ý đơn giản (subset markdown) và pure — không Vue, không reactive,
// không DOM. Render layer (`components/MarkdownRenderer.vue`) tiêu thụ AST này.
//
// Subset hỗ trợ:
// - Heading h1/h2/h3 (`#`, `##`, `###`)
// - Code fence ```lang ... ``` (lang = `mermaid` → block type riêng)
// - Bullet list (`-`/`*`), ordered list (`\d+.`)
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

export type Block =
  | { type: 'mermaid'; code: string }
  | { type: 'code'; lang: string; code: string }
  | { type: 'h1' | 'h2' | 'h3'; parts: InlinePart[] }
  | { type: 'ul' | 'ol'; items: InlinePart[][] }
  | { type: 'blockquote'; parts: InlinePart[] }
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

    if (line.startsWith('# ')) {
      out.push({ type: 'h1', parts: parseInline(line.slice(2)) })
      i += 1
      continue
    }
    if (line.startsWith('## ')) {
      out.push({ type: 'h2', parts: parseInline(line.slice(3)) })
      i += 1
      continue
    }
    if (line.startsWith('### ')) {
      out.push({ type: 'h3', parts: parseInline(line.slice(4)) })
      i += 1
      continue
    }

    if (/^[-*]\s/.test(line)) {
      const items: InlinePart[][] = []
      while (i < lines.length && /^[-*]\s/.test(lines[i] ?? '')) {
        items.push(parseInline((lines[i] ?? '').replace(/^[-*]\s/, '')))
        i += 1
      }
      out.push({ type: 'ul', items })
      continue
    }
    if (/^\d+\.\s/.test(line)) {
      const items: InlinePart[][] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i] ?? '')) {
        items.push(parseInline((lines[i] ?? '').replace(/^\d+\.\s/, '')))
        i += 1
      }
      out.push({ type: 'ol', items })
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
