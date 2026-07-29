import { ref } from 'vue'
import katex, { type KatexOptions } from 'katex'
import { marked, type Tokens } from 'marked'
import markedKatex from 'marked-katex-extension'
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import 'katex/dist/katex.min.css'

// Markdown rendering for the PWA transcript — a trimmed port of ui-next's
// composables/useMarkdown.ts. SECURITY (identical trust boundary as desktop, per
// security.md sink table "markdown → renderer AST, không inject HTML"): raw HTML
// tokens are dropped and link/image hrefs sanitized at the AST level, so the output
// carries NO author HTML and is safe to inline via v-html. Code fences highlight via
// Shiki (escapes its input); `$…$`/`$$…$$`/```latex go through KaTeX (escaped input,
// trust:false → no author HTML). Mermaid fences degrade to plain code blocks (P1 —
// no live diagram engine on mobile).

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c)

function sanitizeHref(href: string | null | undefined): string {
  const h = (href ?? '').trim()
  if (/^(javascript|data|vbscript):/i.test(h)) return '#'
  return h
}

// Strip a leading YAML front-matter block so config docs don't render metadata as a
// stray horizontal rule + setext heading.
function stripFrontMatter(src: string): string {
  if (!src.startsWith('---')) return src
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(src)
  return m ? src.slice(m[0].length) : src
}

// ── Syntax highlighting via Shiki (dark theme only — the PWA is dark-only) ──
// Fine-grained core bundle: each `import('shiki/langs/<lang>.mjs')` is code-split
// so ONLY these grammars ship (loaded lazily at init) — the full `shiki` bundle
// would emit a chunk per known language (~300, tens of MB). Same 30-grammar set +
// github-dark theme + JS regex engine as the desktop → identical highlight output.
const LANG_LOADERS = [
  () => import('shiki/langs/typescript.mjs'),
  () => import('shiki/langs/javascript.mjs'),
  () => import('shiki/langs/tsx.mjs'),
  () => import('shiki/langs/jsx.mjs'),
  () => import('shiki/langs/json.mjs'),
  () => import('shiki/langs/jsonc.mjs'),
  () => import('shiki/langs/bash.mjs'),
  () => import('shiki/langs/shellscript.mjs'),
  () => import('shiki/langs/python.mjs'),
  () => import('shiki/langs/vue.mjs'),
  () => import('shiki/langs/html.mjs'),
  () => import('shiki/langs/xml.mjs'),
  () => import('shiki/langs/css.mjs'),
  () => import('shiki/langs/scss.mjs'),
  () => import('shiki/langs/markdown.mjs'),
  () => import('shiki/langs/yaml.mjs'),
  () => import('shiki/langs/sql.mjs'),
  () => import('shiki/langs/diff.mjs'),
  () => import('shiki/langs/go.mjs'),
  () => import('shiki/langs/rust.mjs'),
  () => import('shiki/langs/java.mjs'),
  () => import('shiki/langs/c.mjs'),
  () => import('shiki/langs/cpp.mjs'),
  () => import('shiki/langs/csharp.mjs'),
  () => import('shiki/langs/php.mjs'),
  () => import('shiki/langs/ruby.mjs'),
  () => import('shiki/langs/toml.mjs'),
  () => import('shiki/langs/dockerfile.mjs'),
  () => import('shiki/langs/ini.mjs'),
  () => import('shiki/langs/graphql.mjs'),
]
const LANG_ALIAS: Record<string, string> = {
  console: 'bash',
  shellsession: 'bash',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  docker: 'dockerfile',
  text: '',
  txt: '',
  plaintext: '',
}

const THEME = 'github-dark'
let highlighter: HighlighterCore | null = null
let initStarted = false
const ready = ref(false)

function ensureHighlighter(): void {
  if (initStarted) return
  initStarted = true
  createHighlighterCore({
    themes: [import('shiki/themes/github-dark.mjs')],
    langs: LANG_LOADERS,
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  })
    .then((h) => {
      highlighter = h
      ready.value = true
    })
    .catch((err: unknown) => {
      // Non-fatal: highlighting stays plain rather than failing the whole render.
      console.warn('[markdown] Shiki init failed; code blocks stay plain.', err)
    })
}

// ── KaTeX (same options + lenient-retry semantics as desktop) ──
const KATEX_OPTS: KatexOptions = {
  throwOnError: true,
  strict: (errorCode) => (errorCode === 'unknownSymbol' ? 'error' : 'ignore'),
}

const hasLatexCommand = (s: string): boolean => /\\[a-zA-Z]/.test(s)

function renderMath(text: string, displayMode: boolean, output?: KatexOptions['output']): string {
  const opts: KatexOptions = { ...KATEX_OPTS, displayMode, ...(output ? { output } : {}) }
  try {
    return katex.renderToString(text, opts)
  } catch (err) {
    // Unmistakable math (display mode or a LaTeX command) that failed strict is almost
    // always a supported equation with an unsupported glyph — retry leniently.
    if (displayMode || hasLatexCommand(text)) {
      return katex.renderToString(text, { ...opts, strict: 'ignore' })
    }
    throw err
  }
}

function renderMathBlock(src: string): string {
  try {
    return renderMath(src.trim(), true, 'htmlAndMathml')
  } catch {
    return `<pre class="codeplain"><code>${escapeHtml(src)}</code></pre>`
  }
}

function highlightCode(text: string, rawLang: string): string {
  const lang = rawLang === '' ? 'bash' : (LANG_ALIAS[rawLang] ?? rawLang)
  if (lang && highlighter && highlighter.getLoadedLanguages().includes(lang)) {
    return highlighter.codeToHtml(text, { lang, theme: THEME })
  }
  return `<pre class="codeplain"><code>${escapeHtml(text)}</code></pre>`
}

let configured = false
function configure(): void {
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
        const lang = (t.lang || '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
        if (lang === 'latex' || lang === 'tex') return renderMathBlock(t.text)
        // No live mermaid engine on the PWA (P1) — render the fence as plain code.
        if (lang === 'mermaid') return `<pre class="codeplain"><code>${escapeHtml(t.text)}</code></pre>`
        return highlightCode(t.text, lang)
      },
    },
  })
  // LaTeX math via marked-katex-extension: keep its tokenizers but replace the renderer so
  // an unrenderable span degrades to raw source instead of aborting the parse.
  const mathExt = markedKatex()
  type KatexEntry = { level?: 'block' | 'inline'; renderer?: (token: Tokens.Generic) => string }
  for (const ext of (mathExt.extensions ?? []) as KatexEntry[]) {
    const nl = ext.level === 'block' ? '\n' : ''
    ext.renderer = (token) => {
      const t = token as Tokens.Generic & { text: string; displayMode?: boolean }
      try {
        return renderMath(t.text, !!t.displayMode) + nl
      } catch {
        return escapeHtml(t.raw) + nl
      }
    }
  }
  marked.use(mathExt)
}

export function useMarkdown(): { renderMarkdown: (src: string) => string } {
  // Returns sanitized HTML. Reads `ready.value` so a computed calling this re-runs
  // (plain → highlighted) once Shiki finishes loading.
  function renderMarkdown(src: string): string {
    configure()
    ensureHighlighter()
    void ready.value
    if (!src) return ''
    return marked.parse(stripFrontMatter(src), { async: false })
  }
  return { renderMarkdown }
}
