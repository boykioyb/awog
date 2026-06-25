import { marked, type Tokens, type TokensList } from 'marked'
import hljs from 'highlight.js/lib/common'

// Markdown rendering for the preview modal. Security (rules/security.md sink table:
// "markdown từ user → renderer AST, không inject HTML"): raw HTML tokens are dropped
// and link/image hrefs sanitized — we never pass author HTML through to v-html.
// Mermaid fenced blocks are split out as separate segments so they render as live
// (zoomable) diagrams instead of code.

export type MdSegment = { type: 'html'; html: string } | { type: 'mermaid'; code: string }

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c)

function sanitizeHref(href: string | null | undefined): string {
  const h = (href ?? '').trim()
  if (/^(javascript|data|vbscript):/i.test(h)) return '#'
  return h
}

let configured = false
function configure() {
  if (configured) return
  configured = true
  marked.use({
    gfm: true,
    breaks: false,
    walkTokens(token) {
      // Neutralize raw HTML and unsafe link/image targets at the AST level.
      if (token.type === 'html') {
        const t = token as Tokens.HTML
        t.text = ''
        t.raw = ''
      } else if (token.type === 'link' || token.type === 'image') {
        const t = token as Tokens.Link | Tokens.Image
        t.href = sanitizeHref(t.href)
      }
    },
    renderer: {
      html() {
        return ''
      },
      code(token) {
        const t = token as Tokens.Code
        const lang = (t.lang || '').trim().split(/\s+/)[0] ?? ''
        if (lang && hljs.getLanguage(lang)) {
          const out = hljs.highlight(t.text, { language: lang }).value
          return `<pre class="hljs"><code class="language-${escapeHtml(lang)}">${out}</code></pre>`
        }
        return `<pre class="hljs"><code>${escapeHtml(t.text)}</code></pre>`
      },
    },
  })
}

export function useMarkdown() {
  // Split into HTML runs + mermaid blocks, preserving order.
  function renderMarkdown(src: string): MdSegment[] {
    configure()
    const tokens = marked.lexer(src)
    const segments: MdSegment[] = []
    let buf: Tokens.Generic[] = []

    const flush = () => {
      if (!buf.length) return
      const list = buf as unknown as TokensList
      list.links = tokens.links
      segments.push({ type: 'html', html: marked.parser(list) })
      buf = []
    }

    for (const tok of tokens) {
      if (tok.type === 'code' && (tok as Tokens.Code).lang?.trim() === 'mermaid') {
        flush()
        segments.push({ type: 'mermaid', code: (tok as Tokens.Code).text })
      } else {
        buf.push(tok)
      }
    }
    flush()
    return segments
  }

  return { renderMarkdown }
}
