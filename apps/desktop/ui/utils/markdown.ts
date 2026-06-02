import { Marked } from 'marked'
import hljs from 'highlight.js/lib/common'

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
      // Syntax-highlight every other fence with highlight.js. hljs escapes the
      // source itself and wraps tokens in <span class="hljs-*">, which main.css
      // themes via light-dark() (color follows the app appearance). When the
      // fence has no / an unknown language we let hljs auto-detect.
      const language =
        typeof lang === 'string' ? lang.toLowerCase().replace(/[^a-z0-9+#.-]/g, '') : ''
      const highlighted =
        language && hljs.getLanguage(language)
          ? hljs.highlight(text, { language, ignoreIllegals: true }).value
          : hljs.highlightAuto(text).value
      const cls = language ? `hljs language-${language}` : 'hljs'
      return `<pre><code class="${cls}">${highlighted}</code></pre>`
    },
  },
})

export function renderMarkdown(source: string): string {
  return md.parse(source ?? '', { async: false }) as string
}
