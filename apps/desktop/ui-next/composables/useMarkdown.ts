import katex, { type KatexOptions } from 'katex'
import { marked, type Tokens, type TokensList } from 'marked'
import markedKatex from 'marked-katex-extension'
import { createHighlighter, createJavaScriptRegexEngine, type Highlighter } from 'shiki'

// Markdown rendering for the transcript + preview. Security (rules/security.md sink table:
// "markdown từ user → renderer AST, không inject HTML"): raw HTML tokens are dropped and
// link/image hrefs sanitized — we never pass author HTML through to v-html. Syntax
// highlighting goes through Shiki (ADR 0055): VS Code TextMate grammars + themes rendered
// to static HTML; Shiki escapes the code text, so its output is safe to inline. Mermaid
// fenced blocks are split out as separate segments so they render as live (zoomable)
// diagrams instead of code.

// `closed` marks whether the mermaid fence has fully streamed in (its closing ``` has
// arrived). Only a closed fence is safe to render as a live diagram; a still-open one is
// kept as plain code (see isMermaidFenceClosed). Static callers always emit closed:true.
export type MdSegment =
  | { type: 'html'; html: string }
  | { type: 'mermaid'; code: string; closed: boolean }

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

// Strip a leading YAML front-matter block (--- … ---) so config docs (agents,
// skills, rules, commands, ADRs) don't render their metadata as a stray horizontal
// rule + setext heading. Only triggers when the very first line is a `---` fence
// with a matching closing fence below; the raw/code view still shows it verbatim.
function stripFrontMatter(src: string): string {
  if (!src.startsWith('---')) return src
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(src)
  return m ? src.slice(m[0].length) : src
}

// A fenced mermaid block is only safe to render as a live diagram once its closing fence
// has streamed in. marked auto-closes an unterminated fence at end-of-input, so a
// half-typed ```mermaid … block arrives as a `code` token whose `raw` carries no closing
// fence line; rendering that partial source would flash a mermaid parse error on every
// streaming frame. Detect closure by the last non-blank line being a bare fence marker
// (``` / ~~~ with no info string — the info string only ever sits on the OPENING line, and
// a fence marker inside the block would itself have closed it). Only the trailing fence of
// a streaming reply can be open; earlier ones always have content after them.
function isMermaidFenceClosed(raw: string): boolean {
  const lastLine =
    raw
      .replace(/[ \t\r\n]+$/, '')
      .split('\n')
      .pop() ?? ''
  return /^\s{0,3}(?:```+|~~~+)\s*$/.test(lastLine)
}

// ── Syntax highlighting via Shiki (ADR 0055) ──
// Curated grammars LLM transcripts commonly emit, loaded once into a singleton highlighter
// (each grammar/theme is a lazy chunk; the JS regex engine avoids the oniguruma WASM so it
// works under the packaged Electron `app://` sandbox without a wasm-unsafe-eval CSP). A
// fence with NO language defaults to `shell` (in an assistant transcript a bare ``` block
// is almost always a terminal command); an explicit unknown language, or `text`/`txt`/
// `plaintext`, renders plain escaped. There is deliberately no language *auto-detection* —
// auto-detect mis-guessing a shell-command list as SQL was the root cause of the garbled
// highlighting. `ready` flips when the async load completes so consuming computeds
// re-render (plain → highlighted), and `activeTheme` follows the app's dark/light mode.
const SHIKI_LANGS = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'json',
  'jsonc',
  'bash',
  'shellscript',
  'python',
  'vue',
  'html',
  'xml',
  'css',
  'scss',
  'markdown',
  'yaml',
  'sql',
  'diff',
  'go',
  'rust',
  'java',
  'c',
  'cpp',
  'csharp',
  'php',
  'ruby',
  'toml',
  'dockerfile',
  'ini',
  'graphql',
]
// Common fence tags Shiki doesn't resolve as aliases on its own. Empty string → plain.
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

let highlighter: Highlighter | null = null
let initStarted = false
const ready = ref(false)
let activeTheme: 'github-dark' | 'github-light' = 'github-dark'

function ensureHighlighter() {
  if (initStarted) return
  initStarted = true
  createHighlighter({
    themes: ['github-dark', 'github-light'],
    langs: SHIKI_LANGS,
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  })
    .then((h) => {
      highlighter = h
      ready.value = true
    })
    .catch((err: unknown) => {
      // Non-fatal: highlighting stays plain. Failing the whole render would be worse.
      console.warn('[useMarkdown] Shiki highlighter init failed; code blocks stay plain.', err)
    })
}

// Shared KaTeX options for every math path (inline `$…$`, block `$$…$$`, ```latex fences).
// `strict` is a FUNCTION so ONLY an unrenderable character fails the render — every other
// non-strict nag is silently ignored. Failing hard on `unknownSymbol` is deliberate:
// marked-katex-extension false-positives on prose that merely CONTAINS `$` (currency like
// "$5 … $10", or Vietnamese/CJK text caught between two dollar signs). Such a span isn't
// real math; without this KaTeX floods the console with "unknownSymbol" AND (unconditional,
// not gated by strict) "No character metrics" warnings and typesets garbled letters.
// throwOnError:true turns that into a thrown error the callers catch → fall back to the RAW
// source text, so a non-math `$…$` renders verbatim and the console stays clean. KaTeX still
// escapes input and (trust:false) emits no author HTML → v-html-safe.
const KATEX_OPTS: KatexOptions = {
  throwOnError: true,
  strict: (errorCode) => (errorCode === 'unknownSymbol' ? 'error' : 'ignore'),
}

// A ```latex / ```tex fenced block renders as a typeset display equation (the system
// prompt advertises this alongside `$$…$$`). On any render failure (malformed LaTeX or an
// unrenderable character) fall back to plain code so the source stays readable.
function renderMathBlock(src: string): string {
  try {
    return katex.renderToString(src.trim(), {
      ...KATEX_OPTS,
      displayMode: true,
      output: 'htmlAndMathml',
    })
  } catch {
    return `<pre class="codeplain"><code>${escapeHtml(src)}</code></pre>`
  }
}

function highlightCode(text: string, rawLang: string): string {
  // Bare fence → default to shell; otherwise resolve aliases ('' → plain).
  const lang = rawLang === '' ? 'bash' : (LANG_ALIAS[rawLang] ?? rawLang)
  if (lang && highlighter && highlighter.getLoadedLanguages().includes(lang)) {
    // Shiki escapes `text` and emits per-token inline colors; the block background +
    // chrome come from the surrounding .mdinline/.mdbody styles.
    return highlighter.codeToHtml(text, { lang, theme: activeTheme })
  }
  return `<pre class="codeplain"><code>${escapeHtml(text)}</code></pre>`
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
        const lang = (t.lang || '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
        if (lang === 'latex' || lang === 'tex') return renderMathBlock(t.text)
        return highlightCode(t.text, lang)
      },
    },
  })
  // LaTeX math: `$…$` inline + `$$…$$` block. We keep marked-katex-extension's tokenizers
  // (its `$`-delimiter boundary rules; it registers inlineKatex/blockKatex tokens — NOT
  // `html` tokens — so the raw-HTML stripping above leaves them intact) but REPLACE the
  // renderer: an unrenderable span (see KATEX_OPTS — chiefly prose that merely contains `$`)
  // degrades to its RAW source text instead of throwing/aborting the parse or spamming the
  // console. KaTeX output is v-html-safe (escaped input, trust:false → no author HTML), same
  // trust boundary as the sanitized markdown. An unclosed delimiter mid-stream never tokenizes
  // → shows as literal `$…` until the closing `$` arrives (mirrors the mermaid streaming rule).
  const mathExt = markedKatex()
  // markedKatex's entries are both tokenizer AND renderer, but marked types `extensions`
  // as a tokenizer|renderer UNION (neither branch exposes both `level` and `renderer`);
  // cast to the concrete shape we mutate.
  type KatexEntry = { level?: 'block' | 'inline'; renderer?: (token: Tokens.Generic) => string }
  for (const ext of (mathExt.extensions ?? []) as KatexEntry[]) {
    const nl = ext.level === 'block' ? '\n' : ''
    ext.renderer = (token) => {
      const t = token as Tokens.Generic & { text: string; displayMode?: boolean }
      try {
        return katex.renderToString(t.text, { ...KATEX_OPTS, displayMode: !!t.displayMode }) + nl
      } catch {
        // Not real math (unrenderable char) or malformed → show the source verbatim.
        return escapeHtml(t.raw) + nl
      }
    }
  }
  marked.use(mathExt)
}

// ── Per-block render cache (streaming jank fix) ──
// renderMarkdown emits ONE html segment per top-level block (not one merged run) and
// memoizes each block's parsed HTML by its raw source. A streaming reply only mutates
// its LAST block each frame, so every earlier block is a cache hit → no re-parse, no
// re-highlight, and (because its `html` prop is byte-identical) SessionMarkdownHtml
// skips its innerHTML rebuild. Per-frame cost becomes ~the size of the current block
// instead of the whole growing document (was O(n²) over a reply → dropped frames).
const PARSE_CACHE_MAX = 1200
const parseCache = new Map<string, string>()
let cacheSig = ''

function renderToken(tok: Tokens.Generic, links: TokensList['links'], useCache: boolean): string {
  if (useCache) {
    const hit = parseCache.get(tok.raw)
    if (hit !== undefined) return hit
  }
  const list = [tok] as unknown as TokensList
  list.links = links
  const html = marked.parser(list)
  if (useCache) {
    if (parseCache.size >= PARSE_CACHE_MAX) {
      // FIFO-evict the oldest ~15% so the cache stays bounded over a long session.
      let n = Math.ceil(PARSE_CACHE_MAX * 0.15)
      for (const k of parseCache.keys()) {
        parseCache.delete(k)
        if (--n <= 0) break
      }
    }
    parseCache.set(tok.raw, html)
  }
  return html
}

export function useMarkdown() {
  // Split into HTML runs + mermaid blocks, in order.
  //
  // `granular` (STREAMING only) emits one segment PER top-level block and memoizes each
  // by its raw source, so a streaming reply re-parses/re-highlights only its last,
  // changing block per frame and SessionMarkdownHtml rebuilds only that block's DOM —
  // the fix for O(n²) streaming jank. Static callers (preview, library, editor, and
  // finalized transcript messages) omit it → the original single merged run, identical
  // layout, parsed once.
  function renderMarkdown(src: string, granular = false): MdSegment[] {
    configure()
    ensureHighlighter()
    // Track reactive deps so consuming computeds re-render when the highlighter finishes
    // loading (plain → highlighted) and when the app theme flips (dark/light → Shiki theme).
    void ready.value
    activeTheme = useTheme().isDark.value ? 'github-dark' : 'github-light'

    const tokens = marked.lexer(stripFrontMatter(src))

    if (!granular) {
      // Original behavior: merge consecutive non-mermaid blocks into one HTML run.
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
          // Static (non-streaming) render → the fence is always complete.
          segments.push({ type: 'mermaid', code: (tok as Tokens.Code).text, closed: true })
        } else {
          buf.push(tok)
        }
      }
      flush()
      return segments
    }

    // Granular: one segment per block, memoized. Theme flip / highlighter-ready changes
    // EVERY block's output → drop the cache.
    const sig = `${activeTheme}|${ready.value ? 1 : 0}`
    if (sig !== cacheSig) {
      parseCache.clear()
      cacheSig = sig
    }
    const lastIdx = tokens.length - 1
    const segments: MdSegment[] = []
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]
      if (!tok || tok.type === 'space') continue
      if (tok.type === 'code' && (tok as Tokens.Code).lang?.trim() === 'mermaid') {
        // Lazy render: a fence renders as a live diagram the moment its closing ``` has
        // streamed in; the trailing, still-open fence stays plain code until it closes.
        const code = tok as Tokens.Code
        segments.push({ type: 'mermaid', code: code.text, closed: isMermaidFenceClosed(code.raw) })
        continue
      }
      // Don't cache the last block: while streaming it changes every frame, so caching
      // each intermediate version would just churn the cache. Earlier blocks are stable.
      const html = renderToken(tok, tokens.links, i !== lastIdx)
      if (html.trim()) segments.push({ type: 'html', html })
    }
    return segments
  }

  return { renderMarkdown }
}
