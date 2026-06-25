<template>
  <!-- The sanitized markdown segments are rendered into this element imperatively (see
       below) so we can wrap quoted excerpts in numbered <mark>s AFTER render without
       dropping the markdown. The container is Vue-rendered (carries the scoped style
       attribute → :deep(...) rules below still apply to the imperative children). -->
  <div ref="root" class="blk txt mdinline" />
</template>

<script setup lang="ts">
// Assistant text block: renders sanitized inline markdown (§3) and, when the block
// carries follow-up ranges, a numbered quote highlight (§8).
//
// Highlight mapping (§8): a follow-up is matched to this block by substring-matching its
// `excerpt` against the RENDERED text (utils/quote-highlight), then the matched span is
// wrapped in a `<mark class="qmark">` carrying a circled `<sup>` number. The wrapping is
// done on the PARSED DOM after render (not by splicing tags into the HTML string), so it
// keeps both the markdown formatting AND the inline number — and stays XSS-safe (the
// segment HTML is already sanitized by useMarkdown). We render the segments imperatively
// (rather than v-html) so we own the subtree and can rebuild it cleanly — markdown first,
// then re-apply the marks — on every content/highlight change.
import type { Followup } from '~/composables/useSessionsMock'
import { locateMarks, type QuoteMark } from '~/utils/quote-highlight'

// A follow-up plus its index in `active.followups` (used for the circled label).
export type BlockHighlight = { fu: Followup; label: string }

const props = defineProps<{ text: string; highlights?: BlockHighlight[] }>()
const { renderMarkdown } = useMarkdown()
const root = useTemplateRef<HTMLElement>('root')

// While the trailing block streams, `text` mutates every typewriter frame (~16ms).
// Re-lexing + highlighting the FULL markdown and swapping the v-html subtree each
// frame is the main cause of choppy streaming, so coalesce parses to ~30fps with a
// trailing pass that always renders the settled text. Finalized blocks never change
// `text`, so the watch is idle and they parse exactly once.
const RENDER_THROTTLE = 33
const renderSrc = ref(props.text)
let lastRender = 0
let trailing: ReturnType<typeof setTimeout> | null = null
watch(
  () => props.text,
  (txt) => {
    const wait = RENDER_THROTTLE - (performance.now() - lastRender)
    if (trailing) {
      clearTimeout(trailing)
      trailing = null
    }
    if (wait <= 0) {
      lastRender = performance.now()
      renderSrc.value = txt
    } else {
      trailing = setTimeout(() => {
        lastRender = performance.now()
        trailing = null
        renderSrc.value = props.text
      }, wait)
    }
  },
)
// Sanitized markdown segments (html runs + mermaid code).
const segments = computed(() => renderMarkdown(renderSrc.value))

// Render the segments into `root`. HTML runs go in via innerHTML (already sanitized by
// useMarkdown — same trust boundary as v-html); mermaid degrades to plain code text
// (textContent, so it's escaped). PreviewModal still owns full mermaid rendering.
function renderInto(el: HTMLElement) {
  el.replaceChildren()
  for (const seg of segments.value) {
    if (seg.type === 'html') {
      const div = document.createElement('div')
      div.innerHTML = seg.html
      el.appendChild(div)
    } else {
      const pre = document.createElement('pre')
      pre.className = 'hljs'
      const code = document.createElement('code')
      code.textContent = seg.code
      pre.appendChild(code)
      el.appendChild(pre)
    }
  }
}

// Wrap each quoted excerpt in a numbered <mark>. Overlapping matches (rare) are dropped;
// the rest are wrapped LAST-first so wrapping a later span can't shift the offsets/nodes
// of an earlier one. extractContents preserves any inline formatting inside the span.
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
  kept.sort((a, b) => b.start - a.start)
  for (const m of kept) {
    try {
      const mark = document.createElement('mark')
      mark.className = 'qmark'
      mark.appendChild(m.range.extractContents())
      const sup = document.createElement('sup')
      sup.className = 'qnum'
      sup.textContent = m.label
      mark.appendChild(sup)
      m.range.insertNode(mark)
    } catch {
      // Selection crossed element boundaries we can't cleanly wrap — skip this mark.
    }
  }
}

// Rebuild the subtree from scratch (clean markdown) then re-apply marks. Runs on mount
// and after the markdown DOM settles whenever the content or highlights change
// (flush:'post' so the freshly rendered DOM is in place before we mark it).
function rerender() {
  const el = root.value
  if (!el) return
  renderInto(el)
  applyMarks(el)
}
onMounted(rerender)
watch([segments, () => props.highlights], rerender, { flush: 'post' })
onBeforeUnmount(() => {
  if (trailing) clearTimeout(trailing)
})
</script>

<style scoped>
/* Inline-markdown styling for the transcript (§3). Colors via theme tokens only;
   sizing inherits .blk.txt (text-[1em]). Reasonably complete (tables, hr, headings,
   spacing, line-height) — PreviewModal still owns heavy/full-screen rendering. */
.mdinline {
  line-height: 1.6;
}
/* No top gap on the block's first element (heading/para/table). */
.mdinline :deep(div:first-child > :first-child) {
  margin-top: 0;
}
.mdinline :deep(p) {
  margin: 0 0 10px;
}
.mdinline :deep(p:last-child) {
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
}
.mdinline :deep(pre) {
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
/* GFM tables — bordered, padded, header tint, zebra rows. Wide tables scroll in
   place (display:block + overflow) so they never push the page/bubble width. */
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
}
</style>
