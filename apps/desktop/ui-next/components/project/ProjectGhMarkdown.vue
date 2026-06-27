<template>
  <!-- Sanitized markdown for an issue/PR body, comment or review. useMarkdown drops
       raw HTML + unsafe hrefs and Shiki-escapes code, so each segment's `.html` is
       safe to inline; we render it imperatively (innerHTML on a Vue-owned node) so the
       scoped .ghmd styles in the drawer apply, mirroring SessionMarkdownHtml. -->
  <div ref="root" class="ghmdbody" />
</template>

<script setup lang="ts">
// One markdown run for the GitHub drawer (body / comment / review). Reuses
// useMarkdown().renderMarkdown — the same sanitized renderer the session transcript
// uses — instead of hand-splitting on \n\n + plain <p>. Mermaid segments (rare in
// gh prose) render as a plain code card; everything else is sanitized HTML.
import { useMarkdown } from '~/composables/useMarkdown'

const props = defineProps<{ source: string }>()

const { renderMarkdown } = useMarkdown()
const root = useTemplateRef<HTMLElement>('root')

// Joined HTML of the sanitized segments. Mermaid fences (no quote/diagram chrome
// needed here) fall back to an escaped <pre> so they never inject markup.
const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c)

const html = computed(() =>
  renderMarkdown(props.source || '')
    .map((seg) =>
      seg.type === 'html'
        ? seg.html
        : `<pre class="codeplain"><code>${escapeHtml(seg.code)}</code></pre>`,
    )
    .join('\n'),
)

function rerender(): void {
  const el = root.value
  if (el) el.innerHTML = html.value
}
onMounted(rerender)
watch(html, rerender, { flush: 'post' })
</script>

<style scoped>
/* Inherit the drawer's .ghmd typography (font-size/line-height); add the inline
   prose styling the markdown needs. Colors via theme tokens only. */
.ghmdbody :deep(:first-child) {
  margin-top: 0;
}
.ghmdbody :deep(> :last-child) {
  margin-bottom: 0;
}
.ghmdbody :deep(p) {
  margin: 0 0 9px;
}
.ghmdbody :deep(strong),
.ghmdbody :deep(b) {
  font-weight: 600;
}
.ghmdbody :deep(em) {
  font-style: italic;
}
.ghmdbody :deep(code) {
  font-family: var(--code);
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 4px;
  font-size: 0.92em;
  overflow-wrap: anywhere;
}
.ghmdbody :deep(pre) {
  margin: 0 0 9px;
  padding: 10px 12px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow-x: auto;
  line-height: 1.5;
}
.ghmdbody :deep(pre code) {
  background: none;
  border: 0;
  padding: 0;
  font-size: 0.92em;
}
.ghmdbody :deep(ul),
.ghmdbody :deep(ol) {
  margin: 0 0 9px;
  padding-left: 22px;
}
.ghmdbody :deep(ul) {
  list-style: disc;
}
.ghmdbody :deep(ol) {
  list-style: decimal;
}
.ghmdbody :deep(li) {
  margin: 3px 0;
}
.ghmdbody :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.ghmdbody :deep(blockquote) {
  margin: 0 0 9px;
  padding: 2px 0 2px 12px;
  border-left: 3px solid var(--border);
  color: var(--textDim);
}
.ghmdbody :deep(h1),
.ghmdbody :deep(h2),
.ghmdbody :deep(h3),
.ghmdbody :deep(h4),
.ghmdbody :deep(h5) {
  font-weight: 600;
  line-height: 1.3;
  margin: 14px 0 7px;
}
.ghmdbody :deep(h1) {
  font-size: 1.3em;
}
.ghmdbody :deep(h2) {
  font-size: 1.18em;
}
.ghmdbody :deep(h3) {
  font-size: 1.08em;
}
.ghmdbody :deep(hr) {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 12px 0;
}
.ghmdbody :deep(table) {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 0 0 10px;
  font-size: 0.96em;
}
.ghmdbody :deep(th),
.ghmdbody :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 11px;
  text-align: left;
  vertical-align: top;
}
.ghmdbody :deep(th) {
  background: var(--bgInput);
  font-weight: 600;
}
.ghmdbody :deep(img) {
  max-width: 100%;
}
</style>
