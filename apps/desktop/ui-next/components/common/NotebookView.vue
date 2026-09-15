<template>
  <div class="nbv">
    <!-- Not JSON / not nbformat: say so instead of rendering an empty shell. -->
    <div v-if="!notebook" class="nbstate">
      <Icon name="alert" style="width: var(--icon-lg); height: var(--icon-lg)" />
      <span>
        {{ t(truncated ? 'sessionsWidget.notebook.cut' : 'sessionsWidget.notebook.invalid') }}
      </span>
    </div>
    <div v-else-if="!notebook.cells.length" class="nbstate">
      <Icon name="book" style="width: var(--icon-lg); height: var(--icon-lg)" />
      <span>{{ t('sessionsWidget.notebook.empty') }}</span>
    </div>

    <template v-else>
      <div class="nbbar">
        <Icon name="book" style="width: var(--icon-sm); height: var(--icon-sm)" />
        <span>{{ t('sessionsWidget.notebook.cells', { n: notebook.cells.length }) }}</span>
        <span v-if="notebook.language" class="nbchip">{{ notebook.language }}</span>
        <span v-if="hasMore" class="nbchip">
          {{
            t('sessionsWidget.notebook.showing', {
              n: cells.length,
              total: notebook.cells.length,
            })
          }}
        </span>
      </div>

      <div v-for="c in cells" :key="c.key" class="nbcell">
        <div class="nbgut" :class="{ run: c.type === 'code' }">{{ c.gutter }}</div>
        <div class="nbmain">
          <!-- markdown cell: same renderer as every other markdown surface -->
          <div v-if="c.type === 'markdown'" class="mdbody nbmd">
            <template v-for="(seg, i) in c.segments" :key="i">
              <MermaidView v-if="seg.type === 'mermaid'" :code="seg.code" />
              <pre
                v-else-if="seg.type === 'widget'"
                class="mmdstream"
              ><code>{{ seg.code }}</code></pre>
              <!-- eslint-disable-next-line vue/no-v-html -- sanitized in useMarkdown -->
              <div v-else v-html="seg.html" />
            </template>
          </div>

          <!-- code cell: Shiki-highlighted (Shiki escapes the source text) -->
          <!-- eslint-disable-next-line vue/no-v-html -- Shiki output, source escaped -->
          <div v-else-if="c.type === 'code'" class="mdbody nbsrc" v-html="c.html" />

          <!-- raw cell: verbatim, never interpreted -->
          <pre v-else class="nbraw">{{ c.text }}</pre>

          <div v-for="(o, oi) in c.outputs" :key="oi" class="nbout">
            <pre v-if="o.k === 'text'" class="nbtext" :class="{ err: o.err }">{{ o.text }}</pre>
            <img v-else-if="o.k === 'image'" class="nbimg" :src="o.src" :alt="o.alt" />
            <!-- Rich HTML output (pandas repr, plotly stub…) is model/kernel-produced
                 L1 markup → fully-restricted sandbox, never the app document. -->
            <iframe
              v-else-if="o.k === 'html'"
              class="nbframe"
              sandbox=""
              loading="lazy"
              referrerpolicy="no-referrer"
              :srcdoc="o.srcdoc"
              :title="t('sessionsWidget.notebook.outputHtml')"
            />
            <div v-else-if="o.k === 'error'" class="nberr">
              <div class="nberrhead">{{ o.title }}</div>
              <pre v-if="o.trace" class="nbtext err">{{ o.trace }}</pre>
            </div>
            <div v-else class="nbskip">{{ o.label }}</div>
          </div>
        </div>
      </div>

      <button v-if="hasMore" class="nbmore" @click="showMore">
        {{ t('sessionsWidget.notebook.more', { n: remaining }) }}
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
// Jupyter notebook (.ipynb) reader for the shared PreviewModal (kind: 'notebook').
//
// Parsing is hand-rolled on top of JSON.parse: an .ipynb is L1 input (workspace file /
// SFTP download / attachment), so every field is narrowed before it reaches the DOM and
// nothing unvalidated is interpolated into markup. No new dependency — markdown goes
// through useMarkdown (which drops raw HTML at the AST level and escapes code) and code
// cells reuse the same Shiki path by round-tripping through a fenced block.
//
// Rendering budget (a real notebook can hold hundreds of cells, each with megabytes of
// base64 output):
//   - cells render CELL_PAGE at a time behind a "show more" button;
//   - a cell's source is clipped at SRC_MAX chars, an output's text at OUT_MAX;
//   - inline images / rich HTML outputs are capped at ASSET_MAX bytes.
//
// Untrusted-output policy:
//   - text/stream/traceback → text interpolation only ({{ }}), never markup;
//   - image/* → a data: URL in an <img> (an <img>-loaded SVG can neither run script nor
//     fetch anything), with the base64 payload charset-validated first;
//   - text/html → an iframe with `sandbox` FULLY restricting (empty attribute: no
//     scripts, no forms, no popups, no same-origin) plus a `default-src 'none'` CSP, so
//     a DataFrame repr renders but a hostile one has no reachable sink.
import type { MdSegment } from '~/composables/useMarkdown'

const props = defineProps<{
  /** Raw .ipynb file text. Untrusted (L1) — parsed and narrowed below, never trusted. */
  source: string
  /** The read was capped by the preview's byte limit, so the JSON is cut mid-document. */
  truncated?: boolean
}>()

const { t } = useI18n()
const { renderMarkdown } = useMarkdown()

// ── nbformat shapes (narrowed from JSON.parse, never trusted as-is) ────────────
type NbCell = {
  cell_type: string
  source: string | string[]
  execution_count?: number | null
  outputs?: unknown[]
}
type Notebook = { cells: NbCell[]; language: string }

const CELL_PAGE = 30
const SRC_MAX = 40_000
const OUT_MAX = 20_000
// Cap for one inline asset (base64 image / html output). Past this the cell shows a
// placeholder rather than pushing a multi-MB data: URL through the layout.
const ASSET_MAX = 3 * 1024 * 1024
// Kernel tracebacks are ANSI-colored; strip the SGR escapes so they read as plain text.
// eslint-disable-next-line no-control-regex -- the ESC control char IS what we match here
const RE_ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g
// Base64 alphabet only — a payload with anything else never becomes a data: URL.
const RE_B64 = /^[A-Za-z0-9+/=\s]+$/
// Fence info string Shiki/marked will accept; anything else renders plain-escaped.
const RE_LANG = /^[a-z0-9+#-]{1,20}$/
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

const asText = (v: unknown): string =>
  typeof v === 'string'
    ? v
    : Array.isArray(v)
      ? v.filter((x) => typeof x === 'string').join('')
      : ''

const clip = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max)}\n${t('sessionsWidget.notebook.truncated')}` : s

function isCell(v: unknown): v is NbCell {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return (
    typeof c.cell_type === 'string' && (typeof c.source === 'string' || Array.isArray(c.source))
  )
}

// Kernel language, for the code cells' syntax highlighting. Python is the default
// because an .ipynb without language metadata is virtually always a Python notebook.
function languageOf(meta: unknown): string {
  if (typeof meta !== 'object' || meta === null) return 'python'
  const m = meta as Record<string, unknown>
  const info = m.language_info as Record<string, unknown> | undefined
  const spec = m.kernelspec as Record<string, unknown> | undefined
  const raw =
    (typeof info?.name === 'string' ? info.name : undefined) ??
    (typeof spec?.language === 'string' ? spec.language : undefined)
  const lang = (raw ?? 'python').toLowerCase()
  return RE_LANG.test(lang) ? lang : 'python'
}

const notebook = computed<Notebook | null>(() => {
  const src = props.source
  if (!src.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(src)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const nb = parsed as Record<string, unknown>
  if (!Array.isArray(nb.cells)) return null
  return { cells: nb.cells.filter(isCell), language: languageOf(nb.metadata) }
})

// ── windowing ─────────────────────────────────────────────────────────────────
const shown = ref(CELL_PAGE)
// A new file (or an edit reload) restarts the window — otherwise the previous
// notebook's scroll depth would carry over to an unrelated document.
watch(
  () => props.source,
  () => {
    shown.value = CELL_PAGE
  },
)
const total = computed(() => notebook.value?.cells.length ?? 0)
const hasMore = computed(() => total.value > shown.value)
const remaining = computed(() => Math.min(CELL_PAGE, total.value - shown.value))
const showMore = () => {
  shown.value += CELL_PAGE
}

// ── outputs ───────────────────────────────────────────────────────────────────
type NbOut =
  | { k: 'text'; text: string; err: boolean }
  | { k: 'image'; src: string; alt: string }
  | { k: 'html'; srcdoc: string }
  | { k: 'error'; title: string; trace: string }
  | { k: 'other'; label: string }

// `default-src 'none'` kills every network fetch (images, styles, XHR, websockets)
// from inside the frame; inline styles are the only thing a DataFrame repr needs.
// Combined with the empty `sandbox` attribute (opaque origin, scripts disabled) the
// document has no reachable sink. `sandbox` is the enforcement; the CSP is depth.
const OUTPUT_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'; " +
  "form-action 'none'; base-uri 'none'"

function htmlOutputDoc(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${OUTPUT_CSP}"><style>html,body{margin:0;padding:8px;background:#fff;color:#111;font:13px/1.5 system-ui,sans-serif}table{border-collapse:collapse}th,td{border:1px solid #ddd;padding:4px 8px}</style></head><body>${body}</body></html>`
}

function imageOutput(data: Record<string, unknown>): NbOut | null {
  for (const mime of IMAGE_MIMES) {
    const raw = asText(data[mime])
    if (!raw) continue
    const b64 = raw.replace(/\s+/g, '')
    if (!b64 || !RE_B64.test(raw) || b64.length > ASSET_MAX) continue
    return { k: 'image', src: `data:${mime};base64,${b64}`, alt: mime }
  }
  // SVG travels as text. Percent-encoding (not base64) keeps non-Latin1 glyphs intact;
  // an <img>-loaded SVG is inert — no scripts, no external references.
  const svg = asText(data['image/svg+xml'])
  if (svg && svg.length <= ASSET_MAX)
    return {
      k: 'image',
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      alt: 'image/svg+xml',
    }
  return null
}

function richOutput(data: Record<string, unknown>): NbOut {
  const img = imageOutput(data)
  if (img) return img
  const html = asText(data['text/html'])
  if (html) {
    if (html.length > ASSET_MAX) return { k: 'other', label: t('sessionsWidget.notebook.tooBig') }
    return { k: 'html', srcdoc: htmlOutputDoc(html) }
  }
  const plain = asText(data['text/plain'])
  if (plain) return { k: 'text', text: clip(plain.replace(RE_ANSI, ''), OUT_MAX), err: false }
  const keys = Object.keys(data).join(', ')
  return { k: 'other', label: t('sessionsWidget.notebook.outputOther', { types: keys || '?' }) }
}

function mapOutputs(outputs: unknown[] | undefined): NbOut[] {
  if (!Array.isArray(outputs)) return []
  const out: NbOut[] = []
  for (const raw of outputs) {
    if (typeof raw !== 'object' || raw === null) continue
    const o = raw as Record<string, unknown>
    const type = typeof o.output_type === 'string' ? o.output_type : ''
    if (type === 'stream') {
      const text = clip(asText(o.text).replace(RE_ANSI, ''), OUT_MAX)
      if (text) out.push({ k: 'text', text, err: o.name === 'stderr' })
    } else if (type === 'error') {
      const name = typeof o.ename === 'string' ? o.ename : t('sessionsWidget.notebook.error')
      const value = typeof o.evalue === 'string' ? o.evalue : ''
      const trace = Array.isArray(o.traceback)
        ? clip(
            o.traceback
              .filter((l): l is string => typeof l === 'string')
              .join('\n')
              .replace(RE_ANSI, ''),
            OUT_MAX,
          )
        : ''
      out.push({ k: 'error', title: value ? `${name}: ${value}` : name, trace })
    } else if (typeof o.data === 'object' && o.data !== null) {
      out.push(richOutput(o.data as Record<string, unknown>))
    }
  }
  return out
}

// ── cells ─────────────────────────────────────────────────────────────────────
type RenderedCell =
  | { key: string; type: 'markdown'; gutter: string; segments: MdSegment[]; outputs: NbOut[] }
  | { key: string; type: 'code'; gutter: string; html: string; outputs: NbOut[] }
  | { key: string; type: 'raw'; gutter: string; text: string; outputs: NbOut[] }

// Round-trip a code cell through the markdown renderer so it picks up the app's one
// Shiki setup (theme, loaded grammars, escaping) instead of a second highlighter.
// The fence is longer than any backtick run inside the source so a cell containing
// ``` can't terminate it early.
function fenced(code: string, lang: string): string {
  let longest = 2
  for (const m of code.matchAll(/`+/g)) longest = Math.max(longest, m[0].length)
  const bar = '`'.repeat(longest + 1)
  return `${bar}${lang}\n${code}\n${bar}`
}

function codeHtml(code: string, lang: string): string {
  const segs = renderMarkdown(fenced(code, lang))
  const first = segs[0]
  return first?.type === 'html' ? first.html : ''
}

const cells = computed<RenderedCell[]>(() => {
  const nb = notebook.value
  if (!nb) return []
  return nb.cells.slice(0, shown.value).map((cell, i) => {
    const key = `${i}`
    const source = clip(asText(cell.source), SRC_MAX)
    if (cell.cell_type === 'markdown')
      return { key, type: 'markdown', gutter: '', segments: renderMarkdown(source), outputs: [] }
    if (cell.cell_type === 'code') {
      const n = typeof cell.execution_count === 'number' ? String(cell.execution_count) : ' '
      return {
        key,
        type: 'code',
        gutter: `[${n}]`,
        html: codeHtml(source, nb.language),
        outputs: mapOutputs(cell.outputs),
      }
    }
    return { key, type: 'raw', gutter: '', text: source, outputs: [] }
  })
})
</script>

<style scoped>
.nbv {
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
  padding: 4px 0 24px;
}
.nbbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 0 12px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.nbchip {
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  padding: 1px 8px;
}
.nbcell {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 0;
}
/* Execution-count gutter — the `In [n]:` column Jupyter shows next to code cells. */
.nbgut {
  flex: 0 0 46px;
  text-align: right;
  padding-top: 12px;
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.nbgut.run {
  /* mono-ok: execution counter aligns with the code block it labels */
  font-family: var(--code);
}
.nbmain {
  flex: 1;
  min-width: 0;
}
.nbmd {
  font-size: var(--fs-md);
  line-height: var(--lh-prose);
}
/* Shiki emits its own <pre>; .mdbody styles it like any other code fence. */
.nbsrc :deep(pre) {
  margin: 0;
}
.nbraw {
  /* mono-ok: a raw cell is verbatim source, kept byte-for-byte */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  white-space: pre-wrap;
  overflow-x: auto;
  background: var(--bgSubtle);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 12px 14px;
  color: var(--textDim);
}
.nbout {
  margin-top: 6px;
}
.nbtext {
  /* mono-ok: kernel stdout/stderr is terminal output */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  white-space: pre-wrap;
  overflow-x: auto;
  margin: 0;
  padding: 8px 12px;
  border-left: 2px solid var(--border);
  color: var(--textDim);
}
.nbtext.err {
  border-left-color: var(--danger);
  color: var(--danger);
}
.nbimg {
  max-width: 100%;
  height: auto;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: #fff; /* design-token-ok: plots are drawn for a white canvas */
}
/* Rich HTML output: fixed box (the frame is opaque-origin, so it cannot report its
   own height back) — it scrolls internally instead of stretching the notebook. */
.nbframe {
  width: 100%;
  height: 260px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: #fff; /* design-token-ok: matches the srcdoc's own canvas */
}
.nberr {
  border-left: 2px solid var(--danger);
  padding-left: 2px;
}
.nberrhead {
  padding: 4px 12px;
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
}
.nberr .nbtext {
  border-left: 0;
}
.nbskip {
  padding: 6px 12px;
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.nbmore {
  display: block;
  width: 100%;
  margin-top: 12px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.nbmore:hover {
  border-color: var(--accentBorder);
  background: var(--accentDim);
  color: var(--text);
}
.nbstate {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 32px 0;
  color: var(--textDim);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
</style>
