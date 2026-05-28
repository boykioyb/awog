import { Marked } from 'marked'

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] ?? c)

// Encode UTF-8 source into base64 safely (btoa rejects non-Latin1 bytes).
const encodeSource = (s: string): string =>
  typeof window === 'undefined'
    ? Buffer.from(s, 'utf8').toString('base64')
    : window.btoa(unescape(encodeURIComponent(s)))

// Use a dedicated instance so we don't mutate the global parser if other code uses marked.
const md = new Marked({
  // `gfm` + `breaks` give the most natural rendering for LLM replies (line breaks preserved,
  // tables/strikethrough supported). `html: false` (default in marked) means raw HTML in the
  // markdown source is escaped — required by AWOG security invariant #4 for L1 untrusted content.
  gfm: true,
  breaks: true,
})

md.use({
  renderer: {
    // Mermaid fences are emitted as a placeholder div carrying the source in a
    // data-attr; SessionMessageList scans for `.awog-mermaid:not([data-rendered])`
    // post-paint and runs mermaid.render() to swap in the SVG. The <pre><code>
    // fallback inside is what the user sees mid-stream (when the diagram source
    // is incomplete) or if mermaid fails to parse.
    code({ text, lang }) {
      if (lang === 'mermaid') {
        return `<div class="awog-mermaid" data-source="${encodeSource(text)}"><pre><code class="language-mermaid">${escapeHtml(text)}</code></pre></div>`
      }
      return false as unknown as string
    },
  },
})

export function renderMarkdown(source: string): string {
  return md.parse(source ?? '', { async: false }) as string
}
