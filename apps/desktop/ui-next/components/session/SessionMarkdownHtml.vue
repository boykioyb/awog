<template>
  <!-- One sanitized markdown HTML run, rendered imperatively (not v-html) so we can wrap
       quoted excerpts in numbered <mark>s on the parsed DOM (§8) and overlay a copy button
       on each code block — both need to mutate the rendered subtree. The container is
       Vue-rendered (carries the scoped style attribute → :deep(...) rules still apply). -->
  <div ref="root" class="mdinline" />
</template>

<script setup lang="ts">
// Renders a single markdown HTML run produced by useMarkdown (one segment between mermaid
// blocks). Split out of SessionTextBlock so each run is an independent node — letting
// mermaid segments render as live <MermaidView> diagrams in between (SoC).
//
// Highlight mapping (§8): a follow-up is matched by substring-matching its `excerpt`
// against the RENDERED text (utils/quote-highlight), then the matched span is wrapped in a
// `<mark class="qmark">` with a circled `<sup>` number — done on the PARSED DOM after
// render (not by splicing into the HTML string), keeping markdown formatting + the inline
// number and staying XSS-safe (the HTML is already sanitized by useMarkdown, same trust
// boundary as v-html). Highlights not found in this run are simply skipped by locateMarks.
import type { BlockHighlight } from './SessionTextBlock.vue'
import { locateMarks, type QuoteMark } from '~/utils/quote-highlight'

const props = defineProps<{ html: string; highlights?: BlockHighlight[] }>()
const { t } = useI18n()
const root = useTemplateRef<HTMLElement>('root')
// Opens / shortens workspace file references in the markdown (from SessionDetail).
const filePreview = useFilePreview()

// Wrap each quoted excerpt in numbered <mark>s. A quote spanning multiple blocks yields one
// range per block (locateMarks splits at block boundaries — an inline <mark> can't legally
// span <p>…</p><p>…</p>); the circled number is appended to the LAST range only. Overlapping
// matches (rare) are dropped. All ranges are wrapped in descending document order so
// extractContents on a later span can't shift the nodes/offsets of an earlier one.
// extractContents preserves any inline formatting inside each span.
function applyMarks(el: HTMLElement) {
  const hs = props.highlights ?? []
  if (!hs.length) return
  const found = locateMarks(
    el,
    hs.map((h) => ({ needle: h.fu.excerpt || '', label: h.label })),
  ).sort((a, b) => a.start - b.start)
  const kept: QuoteMark[] = []
  let lastEnd = 0
  for (const m of found) {
    if (m.start < lastEnd) continue // skip overlap
    kept.push(m)
    lastEnd = m.end
  }
  // Flatten to per-range wraps, tagging the last range of each mark with the number badge,
  // then wrap right-to-left in the document.
  const wraps = kept.flatMap((m) =>
    m.ranges.map((range, i) => ({ range, label: i === m.ranges.length - 1 ? m.label : null })),
  )
  wraps.sort((a, b) => b.range.compareBoundaryPoints(Range.START_TO_START, a.range))
  for (const w of wraps) {
    try {
      const mark = document.createElement('mark')
      mark.className = 'qmark'
      mark.appendChild(w.range.extractContents())
      if (w.label != null) {
        const sup = document.createElement('sup')
        sup.className = 'qnum'
        sup.textContent = w.label
        mark.appendChild(sup)
      }
      w.range.insertNode(mark)
    } catch {
      // Selection crossed element boundaries we can't cleanly wrap — skip this span.
    }
  }
}

// Overlay a hover-revealed copy button on each code block. The button markup is a trusted
// constant (icon sprite <use>), appended AFTER applyMarks so its (text-empty) node can't
// interfere with quote matching. The subtree is rebuilt each rerender, so stale buttons +
// their reset timers are detached and GC'd.
const COPY_RESET_MS = 1200
const COPY_SVG = '<svg class="icn"><use href="#i-copy"></use></svg>'
const CHECK_SVG = '<svg class="icn"><use href="#i-check"></use></svg>'
function addCopyButtons(el: HTMLElement) {
  for (const pre of Array.from(el.querySelectorAll('pre'))) {
    const code = pre.querySelector('code')
    if (!code) continue
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'codecopy'
    btn.title = t('common.copy')
    btn.innerHTML = COPY_SVG
    let reset: ReturnType<typeof setTimeout> | null = null
    btn.addEventListener('click', () => {
      void navigator.clipboard.writeText(code.textContent ?? '')
      btn.classList.add('ok')
      btn.title = t('common.copied')
      btn.innerHTML = CHECK_SVG
      if (reset) clearTimeout(reset)
      reset = setTimeout(() => {
        btn.classList.remove('ok')
        btn.title = t('common.copy')
        btn.innerHTML = COPY_SVG
      }, COPY_RESET_MS)
    })
    pre.appendChild(btn)
  }
}

// Turn inline-code file references (e.g. `docs/x.md`, `tasks/#21/plan.md`) and
// relative-path links into clickable chips that open the shared PreviewModal —
// porting the old UI's "click a file path → preview" behaviour.
//
// Inline-code chips are gated on ACTUAL EXISTENCE: a reference is only highlighted
// once filePreview.resolve confirms it maps to a real workspace file, so a merely
// *proposed* filename the model typed in prose (e.g. "add a `requirements.md`")
// stays plain text instead of becoming a fake, dead chip. Resolution is async (one
// cached file-index fetch per session); we bail if a later streaming frame rebuilt
// the subtree (stale renderToken). Only INLINE code is considered (block
// `<pre><code>` is skipped); the path heuristic (filePathOf) is closed so prose
// like `array.map` never linkifies. Listeners die with the subtree on the next
// rerender (innerHTML rebuild), same as the copy buttons.
function linkifyFilePaths(el: HTMLElement) {
  const openAt = (path: string) => (e: Event) => {
    e.preventDefault()
    filePreview.open(path)
  }
  // Markdown links → open in the shared preview instead of letting the SPA router
  // navigate. External URLs (http(s)://, mailto:, tel:) and in-page anchors (#…) keep
  // their default behaviour; every OTHER href is an intra-app/workspace path the
  // router can't resolve — clicking it navigates to a dead route and crashes with
  // "Page not found" (e.g. an extensionless doc path). So we always preventDefault
  // and route it to the file preview, even when filePathOf doesn't recognise an
  // extension (the modal surfaces a clear "could not load" if it isn't a readable file).
  for (const a of Array.from(el.querySelectorAll('a'))) {
    let href = (a.getAttribute('href') ?? '').trim()
    if (!href || href.startsWith('#')) continue // in-page anchor — leave alone
    if (/^([a-z][a-z\d+.-]*:\/\/|mailto:|tel:)/i.test(href)) continue // external — default handling
    // Markdown renderers percent-encode non-ASCII link destinations (e.g. Japanese
    // filenames) — decode so the path matches the real workspace file, not %E3%83…
    try {
      href = decodeURIComponent(href)
    } catch {
      // malformed escape sequence — keep the raw href
    }
    const path = filePathOf(href)
    a.classList.add('filelink')
    a.title = t('sessions.preview.openFile', { path: path ?? href })
    a.addEventListener('click', openAt(path ?? href))
  }
  // Collect inline-code file-path candidates, then resolve them against the real
  // workspace index — only the ones that exist become chips.
  const candidates: { code: HTMLElement; path: string }[] = []
  for (const code of Array.from(el.querySelectorAll('code'))) {
    if (code.closest('pre')) continue // block code, not an inline reference
    const path = filePathOf(code.textContent ?? '')
    if (path) candidates.push({ code: code as HTMLElement, path })
  }
  if (!candidates.length) return
  const token = renderToken
  void Promise.all(candidates.map((c) => filePreview.resolve(c.path))).then((resolved) => {
    if (token !== renderToken) return // subtree replaced while resolving — nodes are stale
    candidates.forEach((c, i) => {
      const real = resolved[i]
      if (!real) return // file doesn't exist → leave as plain inline code (no chip)
      const { code } = c
      code.classList.add('filelink')
      code.setAttribute('role', 'button')
      code.setAttribute('tabindex', '0')
      code.title = t('sessions.preview.openFile', { path: real })
      // Show the path the model wrote (relative to root); the click uses the
      // resolved real path so a bare basename / wrong base still opens correctly.
      const short = filePreview.shorten(c.path)
      if (short !== code.textContent) code.textContent = short
      code.addEventListener('click', openAt(real))
      code.addEventListener('keydown', (e) => {
        const k = (e as KeyboardEvent).key
        if (k === 'Enter' || k === ' ') openAt(real)(e)
      })
    })
  })
}

// Markdown images reference workspace files by a path relative to the session's workspace
// root (e.g. a QA report's evidence screenshots: `![RFQ](tasks/…/ac-001-rfq.png)`). The
// renderer would resolve that relative src against the PAGE origin (app://bundle/… or the
// dev server) — not the workspace — so the <img> 404s and shows a broken icon. Read the
// real bytes via the sidecar (filePreview.imageSrc → data: URL) and swap the src in. Runs
// after each subtree rebuild; the renderToken guard drops a write whose nodes a later
// streaming frame already replaced. Reads are cached in useFilePreview, so re-renders
// re-apply the resolved src without re-reading. Absolute/remote srcs are left untouched.
function resolveImages(el: HTMLElement) {
  const imgs = Array.from(el.querySelectorAll('img'))
  if (!imgs.length) return
  const token = renderToken
  for (const img of imgs) {
    const raw = (img.getAttribute('src') ?? '').trim()
    if (!raw || /^(?:https?:|data:|blob:|app:|file:)/i.test(raw)) continue // already loadable
    // Stop the doomed relative-URL load (a flashed broken icon against the page origin)
    // while the real bytes are read from the workspace.
    img.removeAttribute('src')
    img.classList.add('imgloading')
    void filePreview.imageSrc(raw).then((url) => {
      if (token !== renderToken || !img.isConnected) return // subtree replaced while reading
      img.classList.remove('imgloading')
      if (url) {
        img.src = url
      } else {
        // Unresolved (missing file / browser-dev / over cap) → a compact placeholder with
        // the alt text or filename instead of the browser's broken-image icon.
        const ph = document.createElement('span')
        ph.className = 'imgmissing'
        ph.textContent = img.getAttribute('alt') || raw.split('/').pop() || raw
        img.replaceWith(ph)
      }
    })
  }
}

// Rebuild the subtree from the sanitized HTML, then re-apply marks + copy buttons. Runs on
// mount and whenever the HTML or highlights change (flush:'post' so the DOM is in place).
//
// Guarded by the last-rendered html + a highlight CONTENT signature: the parent hands a
// fresh `highlights` array (and re-evaluates this run) on every streaming frame, but only
// the one block whose text actually grew has new `html`. Skipping the rebuild when nothing
// changed is what keeps a streaming reply's per-frame cost bounded to its trailing block
// (rebuild + querySelectorAll over a whole long reply each frame is the jank we're killing).
let lastHtml: string | null = null
let lastHlSig = ''
// Bumped on every actual subtree rebuild; the async file-existence check in
// linkifyFilePaths captures it and bails if a later streaming frame already
// replaced the nodes it was about to turn into chips.
let renderToken = 0
const hlSig = () => (props.highlights ?? []).map((h) => `${h.label} ${h.fu.excerpt}`).join('|')

function rerender() {
  const el = root.value
  if (!el) return
  const sig = hlSig()
  if (props.html === lastHtml && sig === lastHlSig) return
  lastHtml = props.html
  lastHlSig = sig
  renderToken++
  el.innerHTML = props.html
  applyMarks(el)
  addCopyButtons(el)
  linkifyFilePaths(el)
  resolveImages(el)
}
onMounted(rerender)
watch([() => props.html, () => props.highlights], rerender, { flush: 'post' })
</script>

<style scoped>
/* Inline-markdown styling for the transcript (§3). Colors via theme tokens only; sizing
   inherits .blk.txt (text-[1em]). Reasonably complete (tables, hr, headings, spacing,
   line-height) — PreviewModal still owns heavy/full-screen rendering. */
.mdinline {
  line-height: 1.6;
}
/* No top gap on the run's first element (heading/para/table). */
.mdinline :deep(:first-child) {
  margin-top: 0;
}
.mdinline :deep(p) {
  margin: 0 0 10px;
}
.mdinline :deep(p:last-child) {
  margin-bottom: 0;
}
/* Each .mdinline now holds exactly ONE top-level block (per-block streaming render),
   so its block's own bottom margin would double with the 10px inter-segment gap that
   SessionTextBlock owns (`.mdwrap > * + *`). Zero it for one uniform rhythm. */
.mdinline :deep(> :last-child) {
  margin-bottom: 0;
}
.mdinline :deep(strong),
.mdinline :deep(b) {
  font-weight: 600;
}
.mdinline :deep(em) {
  font-style: italic;
}
.mdinline :deep(code) {
  font-family: var(--code);
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 4px;
  font-size: 0.92em;
  /* Long unbreakable tokens (file paths, URLs) must wrap inside the bubble instead
     of spilling past its right edge when the message column is narrow (e.g. with the
     workspace panel open). `/` and `.` aren't break opportunities by default, so allow
     breaking anywhere. Block code (`pre code`) keeps white-space:pre → unaffected,
     scrolls via the pre's overflow-x. */
  overflow-wrap: anywhere;
}
/* Inline-code / link that resolves to a workspace file → clickable preview chip.
   Accent tint (not a grey fill) marks it as actionable, per the chip convention. */
.mdinline :deep(code.filelink),
.mdinline :deep(a.filelink) {
  cursor: pointer;
  color: var(--accent);
  border-color: var(--accentBorder);
  text-decoration: none;
}
.mdinline :deep(code.filelink:hover),
.mdinline :deep(a.filelink:hover),
.mdinline :deep(code.filelink:focus-visible),
.mdinline :deep(a.filelink:focus-visible) {
  background: var(--accentDim);
  border-color: var(--accent);
  outline: none;
}
.mdinline :deep(pre) {
  position: relative;
  margin: 0 0 10px;
  padding: 10px 12px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow-x: auto;
  line-height: 1.5;
}
.mdinline :deep(pre code) {
  background: none;
  border: 0;
  padding: 0;
  font-size: 0.92em;
}
/* Per-code-block copy button — hover-revealed, top-right (mirrors Library/Preview copy). */
.mdinline :deep(.codecopy) {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--textDim);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.12s ease,
    color 0.12s ease,
    background 0.12s ease;
}
.mdinline :deep(pre:hover .codecopy),
.mdinline :deep(.codecopy:focus-visible) {
  opacity: 1;
}
.mdinline :deep(.codecopy:hover) {
  color: var(--text);
  background: var(--bgHover);
}
.mdinline :deep(.codecopy.ok) {
  color: var(--add);
  opacity: 1;
}
.mdinline :deep(.codecopy .icn) {
  width: 13px;
  height: 13px;
}
.mdinline :deep(ul),
.mdinline :deep(ol) {
  margin: 0 0 10px;
  padding-left: 22px;
}
/* Tailwind Preflight resets list-style to none — restore markers for prose lists. */
.mdinline :deep(ul) {
  list-style: disc;
}
.mdinline :deep(ol) {
  list-style: decimal;
}
.mdinline :deep(li) {
  margin: 3px 0;
}
.mdinline :deep(li > ul),
.mdinline :deep(li > ol) {
  margin: 3px 0 0;
}
.mdinline :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.mdinline :deep(blockquote) {
  margin: 0 0 10px;
  padding: 2px 0 2px 12px;
  border-left: 3px solid var(--border);
  color: var(--textDim);
}
.mdinline :deep(h1),
.mdinline :deep(h2),
.mdinline :deep(h3),
.mdinline :deep(h4),
.mdinline :deep(h5) {
  font-weight: 600;
  line-height: 1.3;
  margin: 16px 0 8px;
}
.mdinline :deep(h1) {
  font-size: 1.3em;
}
.mdinline :deep(h2) {
  font-size: 1.18em;
}
.mdinline :deep(h3) {
  font-size: 1.08em;
}
.mdinline :deep(hr) {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 14px 0;
}
/* GFM tables — bordered, padded, header tint, zebra rows. Wide tables scroll in place
   (display:block + overflow) so they never push the page/bubble width. */
.mdinline :deep(table) {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 0 0 12px;
  font-size: 0.96em;
}
.mdinline :deep(th),
.mdinline :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 11px;
  text-align: left;
  vertical-align: top;
}
.mdinline :deep(th) {
  background: var(--bgInput);
  font-weight: 600;
}
.mdinline :deep(tbody tr:nth-child(even)) {
  background: color-mix(in srgb, var(--bgInput) 45%, transparent);
}
.mdinline :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  border: 1px solid var(--border);
}
/* Bytes are being read from the workspace — the relative src is removed so the browser
   doesn't flash a broken icon; show a neutral box until the data: URL lands. */
.mdinline :deep(img.imgloading) {
  min-width: 120px;
  min-height: 72px;
  background: var(--bgInput);
}
/* Fallback for an image that couldn't be resolved/read — a compact dashed chip with the
   alt/filename instead of the browser's broken-image icon. */
.mdinline :deep(.imgmissing) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  color: var(--textDim);
  font-family: var(--code);
  font-size: 0.92em;
}
</style>
