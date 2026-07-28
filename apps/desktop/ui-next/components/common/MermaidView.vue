<template>
  <!-- When fullscreen, teleport to <body> so the position:fixed overlay covers the whole
       viewport: a transformed/filtered ancestor in the transcript would otherwise become
       its containing block and confine it (the "gap at top" bug). Disabled inline. -->
  <Teleport to="body" :disabled="!fullscreen">
    <div class="mmd" :class="{ full: fullscreen }">
      <div class="mmdbar">
        <button class="mmb" :title="t('common.zoomOut')" @click="zoomBy(-0.2)">
          <Icon name="minus" style="width: 13px; height: 13px" />
        </button>
        <button class="mmz" :title="t('common.zoomReset')" @click="reset">
          {{ Math.round(scale * 100) }}%
        </button>
        <button class="mmb" :title="t('common.zoomIn')" @click="zoomBy(0.2)">
          <Icon name="plus" style="width: 13px; height: 13px" />
        </button>
        <button class="mmb" :title="t('common.fit')" @click="fit">
          <Icon name="scan" style="width: 13px; height: 13px" />
        </button>
        <span class="mmsep" />
        <button
          class="mmb"
          :title="fullscreen ? t('common.exitFullscreen') : t('common.fullscreen')"
          @click="toggleFull"
        >
          <Icon :name="fullscreen ? 'minimize' : 'maximize'" style="width: 13px; height: 13px" />
        </button>
      </div>

      <div
        ref="vpRef"
        class="mmdvp"
        @wheel="onWheelZoom"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
      >
        <!-- mermaid output is sanitized (securityLevel:strict) before v-html -->
        <!-- eslint-disable-next-line vue/no-v-html -- mermaid SVG, sanitized -->
        <div v-if="svg" class="mmdstage" :style="stageStyle" v-html="svg" />
        <div v-else-if="error" class="mmderr">
          <Icon name="alert" style="width: 15px; height: 15px" />
          <span>{{ error }}</span>
          <pre class="mmdsrc">{{ source }}</pre>
        </div>
        <div v-else class="mmdwait">{{ t('common.mermaid.rendering') }}</div>
      </div>
    </div>
  </Teleport>
</template>

<script lang="ts">
// Module scope — runs ONCE, NOT per instance: a single counter shared across every
// MermaidView so each mermaid render gets a process-unique id. mermaid keeps GLOBAL
// state keyed by the render id and renders through a temp element with that id, so two
// diagrams sharing an id clobber each other and all but one silently produce an EMPTY
// SVG (no thrown error → blank box, no log). This MUST live outside <script setup>:
// that block re-runs per instance, so a counter declared there resets to 0 every time
// and every diagram starts at mmd-1 → collisions the moment a message with several
// diagrams mounts together.
let mermaidUid = 0
</script>

<script setup lang="ts">
// Renders one Mermaid diagram as live SVG with Shift+wheel-zoom + drag-pan.
// mermaid is dynamically imported (heavy, client-only) and re-rendered on theme
// change. Each render uses a PROCESS-WIDE unique id: mermaid keeps global state and
// renders through a temp element keyed by id, so two diagrams sharing an id (the
// previous per-instance counter all started at 1) clobbered each other and one
// silently produced no SVG. A module-level counter guarantees uniqueness.
const props = defineProps<{ code: string }>()
const { t } = useI18n()
const { isDark } = useTheme()
const { scale, tx, ty, zoomBy, setScale, reset, onPointerDown, onPointerMove, onPointerUp } =
  useZoomPan({
    min: 0.3,
    max: 6,
  })

// Viewport element — measured by fit() to size the diagram to the frame.
const vpRef = useTemplateRef<HTMLElement>('vpRef')

// Fit: scale the diagram so it sits WHOLE inside the viewport, then re-center. The
// stage forces the SVG to the stage width (`.mmdstage :deep(svg){width:100%}`), so at
// 100% only the HEIGHT can overflow (a tall diagram); fit shrinks that to frame it.
// Derived from the SVG's own aspect ratio (viewBox) vs the viewport box — at scale s the
// SVG renders w=s·vpW, h=s·vpW/aspect, so fitting both gives s=min(1, vpH·aspect/vpW).
// Falls back to reset() (100%) when the SVG can't be measured yet.
function fit() {
  const vp = vpRef.value
  const svg = vp?.querySelector('svg')
  if (!vp || !svg) return reset()
  const vb = svg.viewBox?.baseVal
  const aspect = vb && vb.width > 0 && vb.height > 0 ? vb.width / vb.height : 0
  const vpW = vp.clientWidth
  const vpH = vp.clientHeight
  if (!aspect || !vpW || !vpH) return reset()
  tx.value = 0
  ty.value = 0
  setScale(Math.min(1, (vpH * aspect) / vpW))
}

const svg = ref('')
const error = ref('')

// Leading/trailing blank lines occasionally ride along on the fenced source (e.g. a stray
// leading newline shifts every diagnostic line number by one — a 5-line diagram reporting a
// parse error "on line 6"). Strip them so mermaid sees clean source and any surfaced error
// points at the real line. Trailing blank lines are inert but dropped for the same tidiness.
const source = computed(() => props.code.replace(/^\s*\n/, '').replace(/\s+$/, ''))

// Zoom by widening the stage (svg is width:100%) so the SVG re-renders as crisp
// vector at any size; pan stays on transform. CSS transform:scale() would rasterize
// the SVG at its base size and blur when enlarged.
const stageStyle = computed(() => ({
  width: `${scale.value * 100}%`,
  transform: `translate(${tx.value}px, ${ty.value}px)`,
}))

// Wheel zoom is gated on SHIFT so a plain scroll passes straight through to the
// transcript — previously EVERY wheel over a diagram was captured (preventDefault +
// zoom), so scrolling the feed "stuck" the moment the cursor crossed a diagram. Now:
// Shift+wheel zooms (preventDefault, finer steps than the toolbar for smoothness); a
// bare wheel is left alone so `.mmdvp` (overflow:hidden, no inner scroll) lets it bubble
// to the transcript. The toolbar ± buttons remain the modifier-free way to zoom.
function onWheelZoom(e: WheelEvent) {
  if (!e.shiftKey) return
  e.preventDefault()
  // Holding Shift makes the OS/browser deliver the wheel as HORIZONTAL scroll — the
  // delta lands on deltaX and deltaY is ~0. Reading deltaY alone then always saw
  // "not < 0", so both scroll directions only ever zoomed OUT. Use whichever axis
  // actually carries the delta (its sign still encodes up=in / down=out).
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  zoomBy(delta < 0 ? 0.1 : -0.1)
}

// Per-instance token guards against a stale async render (theme/code changed
// mid-render) overwriting the latest result. (The render-id counter `mermaidUid` is
// module-scoped — see the companion <script> block above — so ids never collide.)
let renderToken = 0

// Self-heal transient failures. A diagram can briefly reach us as INCOMPLETE source: the
// transcript renders a fence as a live diagram once its closing ``` arrives, but a
// non-monotonic streaming update (a settle race in the store) can hand us a half-formed
// body for a frame — which mermaid rejects with a parse error ("...Event outbound ^"),
// even though the finalized source is valid. Rather than flash a scary error card, a failed
// render retries within a short grace window (the `code` prop almost always settles to valid
// meanwhile, re-rendering via the watch below); the error surfaces only if the SAME source
// stays invalid across every attempt — i.e. a genuinely malformed diagram.
const MAX_RENDER_ATTEMPTS = 3
const RETRY_DELAY_MS = 350
let attempts = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null
function clearRetry() {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

// Best-effort repair for common LLM mermaid slips, run ONLY after a parse failure — so a
// valid diagram renders on the first pass untouched and this can never corrupt it (the
// retry falls back to the ORIGINAL error if the repaired source still fails).
function repairMermaid(src: string): string {
  const isSeq = /^\s*sequenceDiagram\b/m.test(src)
  const isFlow = /^\s*(flowchart|graph)\b/m.test(src)
  if (!isSeq && !isFlow) return src
  let out = src

  // sequenceDiagram: `;` is a statement separator, so it terminates message/Note text
  // mid-line — `A->>B: do X; then Y` parses as a valid message PLUS an orphan `then Y`
  // that carries no arrow → "Expecting <arrow>, got NEWLINE" at end of line. LLMs
  // routinely write prose with `;` in message text. Neutralise `;` → `,` ONLY in the
  // text after a message/Note colon, leaving structure (arrows, participants) untouched.
  if (isSeq) {
    out = out
      .split('\n')
      .map((line) => {
        const colon = line.indexOf(':')
        if (colon < 0 || !line.slice(colon + 1).includes(';')) return line
        const head = line.slice(0, colon)
        const isMessage = /--?>>?|--?[)x]|<<-?->>?/.test(head) // -> --> ->> -->> -x --x -) --) <<->>
        const isNote = /^\s*note\b/i.test(head)
        if (!isMessage && !isNote) return line
        return `${head}:${line.slice(colon + 1).replace(/;/g, ',')}`
      })
      .join('\n')
  }

  if (isFlow) {
    // (1) A styling statement (classDef/class/style/linkStyle) joined to the previous one
    // by a `;` on the SAME line fuses them for mermaid's parser: the `;` gets swallowed
    // into the preceding value (e.g. `...stroke:#c62828; class K b` → "got 'CLASS',
    // expecting NEWLINE"). Put each such statement on its own line.
    out = out.replace(/;[ \t]*(?=(?:classDef|class|style|linkStyle)\b)/g, '\n')
    // (2) Quote flowchart edge labels whose text carries shape punctuation:
    // `-->|secret('X')|` trips the parser on the `(` (it reads a node shape) unless the
    // label is quoted: `-->|"secret('X')"|`.
    out = out.replace(/\|([^|\n]+)\|/g, (whole, label: string) => {
      const t = label.trim()
      if (t.startsWith('"') || !/[(){}[\]]/.test(t)) return whole
      return `|"${t.replace(/"/g, "'")}"|`
    })
    // (3) Quote node labels whose text carries shape punctuation or a pipe: an
    // unquoted `Z[[] empty]` reads `[[` as a subroutine shape that never finds `]]`
    // ("got 'SQE'"). `Z["[] empty"]` takes the text literally. See quoteNodeLabels.
    out = quoteNodeLabels(out)
    // (4) A quoted label whose text STARTS with a backtick puts mermaid into
    // markdown-string mode (`id["`md`"]`), and an UNBALANCED leading run aborts the
    // lexer — e.g. an LLM diagram whose label literally shows ```` ```mermaid ```` gives
    // "Lexical error … Unrecognized text". Only a backtick immediately after the opening
    // `"` triggers this (a backtick later in the label is inert), so escape just the
    // leading run to the entity code `#96;` — mermaid renders `#nn;` as that character, so
    // the label reads as literal backticks. Runs LAST: steps (2)/(3) can newly quote a
    // label whose text begins with a backtick, creating the `"`+backtick trigger here.
    out = out.replace(/"(`+)/g, (_m, ticks: string) => `"${'#96;'.repeat(ticks.length)}`)
  }
  return out
}

// ── flowchart node-label quoting (repair helper) ─────────────────────────────
// open shape token → its accepted closing tokens. Two-char shapes come first so a
// genuine subroutine/stadium/cylinder/… wins when it actually closes; the one-char
// fallback covers a rectangle/round/rhombus whose label merely STARTS with a bracket.
const MMD_SHAPES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['([', ['])']],
  ['[[', [']]']],
  ['[(', [')]']],
  ['((', ['))']],
  ['{{', ['}}']],
  ['[/', ['/]', '\\]']],
  ['[\\', ['\\]', '/]']],
  ['[', [']']],
  ['(', [')']],
  ['{', ['}']],
  ['>', [']']],
]
// Statement lines that never carry an inline node definition — skipped wholesale so a
// subgraph title / classDef / style value is never rewritten.
const MMD_SKIP_LINE =
  /^\s*(?:flowchart|graph|subgraph|end\b|classDef|class\b|style\b|linkStyle|direction|click|%%)/
// Label text that needs quoting: any shape punctuation or a pipe.
const MMD_NEEDS_QUOTE = /[[\](){}|]/
// A close token is the node's real end only when a statement boundary follows it (end
// of line, or a link/edge operator / `; : & @ |` start).
const MMD_BOUNDARY = /^[-=.<~&;:|@]/

// Is the next non-space thing after `pos` a statement boundary? Empty (EOL) counts.
function mmdBoundaryAt(line: string, pos: number): boolean {
  const rest = line.slice(pos).replace(/^\s+/, '')
  return rest === '' || MMD_BOUNDARY.test(rest)
}

// Earliest close token (from `closes`) at/after `from` that lands on a boundary, or
// null when this shape never closes cleanly — the caller then tries a shorter open
// token, so `[[…]` with no `]]` degrades to a `[…]` rectangle. Scanning to a
// boundary (not the first close) means a `]` INSIDE the label isn't mistaken for the
// node's end: `A[x] --> B` closes A at the `]` before ` -->`, not before it.
function mmdNodeEnd(
  line: string,
  from: number,
  closes: readonly string[],
): { end: number; close: string } | null {
  for (let j = from; j < line.length; j++) {
    for (const close of closes) {
      if (line.startsWith(close, j) && mmdBoundaryAt(line, j + close.length))
        return { end: j, close }
    }
  }
  return null
}

function quoteNodeLabelsInLine(line: string): string {
  let res = ''
  let i = 0
  while (i < line.length) {
    // A node opener is a shape token immediately preceded by an id char (ASCII or
    // unicode letter/number/underscore).
    if (/[\p{L}\p{N}_]/u.test(line[i - 1] ?? '')) {
      let handled = false
      for (const [open, closes] of MMD_SHAPES) {
        if (!line.startsWith(open, i)) continue
        const labelStart = i + open.length
        const found = mmdNodeEnd(line, labelStart, closes)
        if (!found) continue // shape doesn't close here — fall through to a shorter one
        const label = line.slice(labelStart, found.end)
        const quoted =
          label.trimStart().startsWith('"') || !MMD_NEEDS_QUOTE.test(label)
            ? label
            : `"${label.replace(/"/g, "'")}"`
        res += open + quoted + found.close
        i = found.end + found.close.length
        handled = true
        break
      }
      if (handled) continue
    }
    res += line[i]
    i++
  }
  return res
}

// Quote every inline node label that would trip the parser, one statement line at a
// time (labels never span lines in flowchart source — `<br/>` is literal text).
function quoteNodeLabels(src: string): string {
  return src
    .split('\n')
    .map((line) => (MMD_SKIP_LINE.test(line) ? line : quoteNodeLabelsInLine(line)))
    .join('\n')
}

// Parse a CSS colour (hex #rgb/#rrggbb or rgb()) to [r,g,b] 0–255, or null.
function parseColor(raw: string): [number, number, number] | null {
  const c = raw.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(c)?.[1]
  if (hex) {
    const f = hex.length === 3 ? hex.replace(/(.)/g, '$1$1') : hex
    return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)]
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(c)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return null
}

// Read a shape's INLINE fill (from `style="fill:…"` or a `fill` attribute), ignoring
// none/transparent. Theme fills come from the embedded <style>, never inline — so this
// only ever sees a fill the diagram author set explicitly.
function inlineFill(el: Element): string | null {
  const fromStyle = /fill:\s*([^;!]+)/i.exec(el.getAttribute('style') ?? '')?.[1]
  const fill = (fromStyle ?? el.getAttribute('fill') ?? '').trim()
  if (!fill || fill === 'none' || fill === 'transparent') return null
  return fill
}

// mermaid colours node labels from the (dark) theme → light text. When the diagram
// author sets a LIGHT custom fill (e.g. `style X fill:#ffebee` — common in LLM output
// tuned for the light theme), that light text lands on a light fill and is unreadable.
// For every node carrying an inline fill, flip its label ink to dark/light by the fill's
// perceived luminance. Default-fill nodes have no inline fill → left untouched, and the
// whole markup is returned verbatim unless we actually recoloured something (so the
// common no-custom-fill diagram never round-trips). Parse as text/html so the XHTML
// foreignObject label elements expose a working .style; pure colour edits only (no
// markup injected) → still v-html-safe.
function fixNodeContrast(svgMarkup: string): string {
  const doc = new DOMParser().parseFromString(svgMarkup, 'text/html')
  const svgEl = doc.body.querySelector('svg')
  if (!svgEl) return svgMarkup
  let changed = false
  for (const node of Array.from(svgEl.querySelectorAll('.node, .cluster'))) {
    const shape = node.querySelector('rect, polygon, path, circle, ellipse')
    const fill = shape ? inlineFill(shape) : null
    const rgb = fill ? parseColor(fill) : null
    if (!rgb) continue
    // Perceived luminance (ITU-R BT.601); >150/255 ≈ light surface → needs dark ink.
    const ink = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 150 ? '#1a1a1a' : '#f5f5f5'
    for (const lbl of Array.from(
      node.querySelectorAll<HTMLElement>(
        '.nodeLabel, foreignObject div, foreignObject span, foreignObject p',
      ),
    ))
      lbl.style.color = ink
    for (const txt of Array.from(node.querySelectorAll('text'))) txt.setAttribute('fill', ink)
    changed = true
  }
  return changed ? svgEl.outerHTML : svgMarkup
}

async function render() {
  const myToken = ++renderToken
  clearRetry()
  const src = source.value
  if (!src) {
    svg.value = ''
    error.value = t('common.mermaid.empty')
    return
  }
  try {
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: isDark.value ? 'dark' : 'default',
    })
    let out = ''
    try {
      out = (await mermaid.render(`mmd-${++mermaidUid}`, src)).svg
    } catch (first) {
      // Retry once with a repaired source; if it's a no-op or still fails, surface the
      // ORIGINAL parse error so the message points at the real line.
      const repaired = repairMermaid(src)
      if (repaired === src) throw first
      try {
        out = (await mermaid.render(`mmd-${++mermaidUid}`, repaired)).svg
      } catch {
        throw first
      }
    }
    if (myToken !== renderToken) return // superseded by a newer render
    if (!out) {
      error.value = t('common.mermaid.empty')
      svg.value = ''
      return
    }
    svg.value = fixNodeContrast(out)
    error.value = ''
    attempts = 0
  } catch (e) {
    if (myToken !== renderToken) return
    attempts++
    if (attempts < MAX_RENDER_ATTEMPTS) {
      // Likely a still-settling source (see the self-heal note above). Stay on the quiet
      // "rendering" placeholder and retry; a `code`-prop update meanwhile re-renders via
      // the watch and resets the count, so a diagram that becomes valid never flashes red.
      clearRetry()
      retryTimer = setTimeout(() => {
        retryTimer = null
        render()
      }, RETRY_DELAY_MS)
      return
    }
    // Stably invalid across every attempt → a genuinely malformed diagram. Surface the
    // descriptive parse error (the failure used to be silent when an id collision produced
    // empty output instead of throwing).
    error.value = e instanceof Error ? e.message : String(e)
    svg.value = ''
    console.warn('[mermaid] render failed', e)
  }
}

onMounted(render)
// New diagram → reset zoom/pan so it starts framed at 100%, and restart the self-heal
// attempt count (a fresh source deserves its own grace window). Watch the NORMALISED source
// so pure whitespace churn (leading/trailing blank lines coming and going mid-stream)
// doesn't trigger a needless re-render. Theme toggle keeps zoom.
watch(source, () => {
  attempts = 0
  reset()
  render()
})
watch(isDark, render)

// Fullscreen: blow the diagram up to a fixed full-window overlay (above the preview
// modal) so big graphs are readable; zoom/pan still apply inside it.
const fullscreen = ref(false)
function toggleFull() {
  fullscreen.value = !fullscreen.value
}
// Esc exits fullscreen — capture phase + stopPropagation so the parent modal's own
// Esc-to-close doesn't also fire.
function onFsKey(e: KeyboardEvent) {
  if (fullscreen.value && e.key === 'Escape') {
    fullscreen.value = false
    e.stopPropagation()
  }
}
onMounted(() => window.addEventListener('keydown', onFsKey, true))
onBeforeUnmount(() => {
  clearRetry()
  window.removeEventListener('keydown', onFsKey, true)
})
</script>

<style scoped>
.mmd {
  position: relative;
  align-self: stretch;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bgSubtle);
  overflow: hidden;
}
.mmd.full {
  position: fixed;
  inset: 0;
  z-index: 300;
  border: 0;
  border-radius: 0;
  background: var(--bg);
}
.mmd.full .mmdvp {
  height: 100vh;
  max-height: none;
}
/* Slim control pill, consistent with the app's other floating toolbars. */
.mmdbar {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bgEl);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
}
.mmb {
  display: grid;
  place-items: center;
  width: 24px;
  height: 22px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: var(--textDim);
  cursor: pointer;
}
.mmb:hover {
  background: var(--bgHover);
  color: var(--text);
}
.mmz {
  height: 22px;
  min-width: 44px;
  padding: 0 6px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-family: var(--code);
  font-size: 12px;
  color: var(--textFaint);
  cursor: pointer;
}
.mmz:hover {
  background: var(--bgHover);
  color: var(--text);
}
.mmsep {
  width: 1px;
  height: 16px;
  background: var(--border);
  margin: 0 2px;
}
.mmdvp {
  height: 360px;
  max-height: 60vh;
  overflow: hidden;
  display: grid;
  /* Definite track so the stage's width:100% resolves to the viewport width. Without it
     the implicit `auto` column sizes to content, and mermaid's `<svg width="100%">`
     contributes 0 to an auto track → the column (and the diagram) collapses to nothing.
     minmax(0,1fr) fills the container yet still lets a zoomed (>100%) stage overflow +
     be clipped. */
  grid-template-columns: minmax(0, 1fr);
  place-items: center;
  cursor: grab;
  touch-action: none;
  /* The diagram is a pan surface — dragging must not select its label text (the
     blue highlight that appears while panning). Non-selectable throughout. */
  user-select: none;
  -webkit-user-select: none;
}
.mmdvp:active {
  cursor: grabbing;
}
.mmdstage {
  transform-origin: center center;
}
/* Force the mermaid SVG to fill the (zoomable) stage width so it scales as vector. */
.mmdstage :deep(svg) {
  display: block;
  width: 100% !important;
  height: auto !important;
  max-width: none !important;
}
/* Error state: an icon + the parser message + the offending source, so a failed
   diagram is diagnosable instead of an empty grey box. */
.mmderr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: 90%;
  padding: 16px;
  color: var(--danger);
  text-align: center;
}
.mmdsrc {
  margin: 0;
  max-width: 100%;
  max-height: 200px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--textDim);
  font-family: var(--code);
  font-size: 0.8462rem;
  white-space: pre-wrap;
  text-align: left;
}
.mmdwait {
  color: var(--textFaint);
}
</style>
