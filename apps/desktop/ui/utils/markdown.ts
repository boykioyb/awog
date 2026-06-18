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

// Inverse of encodeSource — recover the raw UTF-8 source baked into a
// `.awog-code-block[data-source]` attribute, used by the copy button and the
// full-screen code viewer to operate on the original text (not the highlighted
// markup).
export function decodeSource(s: string): string {
  return typeof window === 'undefined'
    ? Buffer.from(s, 'base64').toString('utf8')
    : decodeURIComponent(escape(window.atob(s)))
}

// Highlight a code source with highlight.js. Shared by the markdown `code`
// renderer and the full-screen code viewer so both produce identical markup
// (hljs escapes the source itself and wraps tokens in <span class="hljs-*">,
// themed by main.css). Unknown / missing language → HTML-escape only, NO
// auto-detect: LLM replies routinely put plain prose (PR titles, branch names,
// shell snippets) in unlabeled fences, and hljs.highlightAuto guesses a wrong
// language → bogus token colors + spurious italics (e.g. `#…` read as a
// comment). Escaping keeps such blocks neutral; real code blocks tag their lang.
export function highlightCode(source: string, lang?: string): { html: string; language: string } {
  const language = typeof lang === 'string' ? lang.toLowerCase().replace(/[^a-z0-9+#.-]/g, '') : ''
  const html =
    language && hljs.getLanguage(language)
      ? hljs.highlight(source, { language, ignoreIllegals: true }).value
      : escapeHtml(source)
  return { html, language }
}

// Highlight a single line of code for a known language. Used by the Git diff
// viewer, which highlights line-by-line (no cross-line context). Unknown /
// empty language → just HTML-escape: per-line auto-detect is slow and
// unreliable, so we don't attempt it. Output is HTML-safe (hljs escapes the
// source; escapeHtml covers the no-highlight path).
export function highlightLine(source: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    return hljs.highlight(source, { language: lang, ignoreIllegals: true }).value
  }
  return escapeHtml(source)
}

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
      // Every other fence: syntax-highlight, then wrap in `.awog-code-block`
      // carrying the raw source (base64) + language. The wrapper anchors the
      // copy / expand actions that SessionMessageList injects post-render; the
      // data-attrs let those affordances copy / re-render the original text
      // instead of scraping the highlighted spans.
      const { html, language } = highlightCode(text, lang)
      const cls = language ? `hljs language-${language}` : 'hljs'
      return `<div class="awog-code-block" data-source="${encodeSource(text)}" data-lang="${language}"><pre><code class="${cls}">${html}</code></pre></div>`
    },
  },
})

export function renderMarkdown(source: string): string {
  return md.parse(source ?? '', { async: false }) as string
}
