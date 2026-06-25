<template>
  <!-- Highlighted path: state-derived <mark> segments (plain text, XSS-safe via
       mustache escaping). Used only when this block carries follow-up ranges so the
       highlight stays correct without injecting into sanitized markdown HTML. -->
  <div v-if="marked.length" class="blk txt mdinline">
    <template v-for="(seg, i) in marked" :key="i">
      <mark
        v-if="seg.kind === 'mark'"
        class="qmark"
        :title="t('sessions.transcript.mark.tooltip', { n: seg.label })"
      >
        <span style="white-space: pre-wrap">{{ seg.text }}</span>
        <sup class="qnum">{{ seg.label }}</sup>
      </mark>
      <span v-else style="white-space: pre-wrap">{{ seg.text }}</span>
    </template>
  </div>
  <!-- Default path: sanitized inline markdown. `html` comes from useMarkdown(), which
       drops raw HTML tokens + sanitizes link/image hrefs at the AST level, so binding
       it via v-html is safe (no author HTML reaches the DOM). Mermaid is left to the
       PreviewModal — here mermaid segments degrade to their plain code text. -->
  <div v-else class="blk txt mdinline">
    <template v-for="(seg, i) in segments" :key="i">
      <!-- eslint-disable-next-line vue/no-v-html -- sanitized by useMarkdown() -->
      <div v-if="seg.type === 'html'" v-html="seg.html" />
      <pre v-else class="hljs"><code>{{ seg.code }}</code></pre>
    </template>
  </div>
</template>

<script setup lang="ts">
// Assistant text block: renders sanitized inline markdown (§3) and, when the block
// carries follow-up ranges, a state-derived numbered highlight (§8).
//
// Highlight mapping (§8): a follow-up is matched to this block either by exact char
// range (its `start`/`end` offsets into `text`) or, when no range is present, by
// substring-matching its `excerpt`. We deliberately DO NOT inject <mark> into the
// sanitized markdown HTML — splicing tags into escaped HTML risks landing inside a
// tag/entity and breaking the sanitization guarantee. Instead, when ANY highlight
// applies we render the block as escaped plain text split into [before][marked][after]
// segments (markdown styling is dropped for that block only). Highlights are rare
// (selection quotes), so the readability tradeoff is acceptable and correctness wins.
import type { Followup } from '~/composables/useSessionsMock'

// A follow-up plus its index in `active.followups` (used for the circled label).
export type BlockHighlight = { fu: Followup; label: string }

const props = defineProps<{ text: string; highlights?: BlockHighlight[] }>()
const { t } = useI18n()
const { renderMarkdown } = useMarkdown()

// Default render: sanitized markdown segments (html runs + mermaid code).
const segments = computed(() => renderMarkdown(props.text))

type MarkSeg = { kind: 'text' | 'mark'; text: string; label: string }

// Resolve each highlight to a [start, end) char range in `text`. Prefer the explicit
// range when present + sane; otherwise fall back to locating the excerpt substring.
function resolveRange(fu: Followup): { start: number; end: number; label: string } | null {
  const len = props.text.length
  if (fu.start != null && fu.end != null && fu.start >= 0 && fu.end <= len && fu.start < fu.end) {
    return { start: fu.start, end: fu.end, label: '' }
  }
  const needle = (fu.excerpt || '').trim()
  if (!needle) return null
  const idx = props.text.indexOf(needle)
  if (idx < 0) return null
  return { start: idx, end: idx + needle.length, label: '' }
}

// State-derived marked segments. Non-overlapping ranges sorted by start; overlapping
// ranges (rare) are skipped to keep slicing simple + safe.
const marked = computed<MarkSeg[]>(() => {
  const hs = props.highlights ?? []
  if (!hs.length) return []
  const ranges = hs
    .map((h) => {
      const r = resolveRange(h.fu)
      return r ? { ...r, label: h.label } : null
    })
    .filter((r): r is { start: number; end: number; label: string } => r != null)
    .sort((a, b) => a.start - b.start)
  if (!ranges.length) return []

  const out: MarkSeg[] = []
  let cursor = 0
  for (const r of ranges) {
    if (r.start < cursor) continue // skip overlap
    if (r.start > cursor)
      out.push({ kind: 'text', text: props.text.slice(cursor, r.start), label: '' })
    out.push({ kind: 'mark', text: props.text.slice(r.start, r.end), label: r.label })
    cursor = r.end
  }
  if (cursor < props.text.length)
    out.push({ kind: 'text', text: props.text.slice(cursor), label: '' })
  return out
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
