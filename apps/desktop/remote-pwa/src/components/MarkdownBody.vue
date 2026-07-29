<script setup lang="ts">
import { computed } from 'vue'
import { useMarkdown } from '../markdown'

// Renders one assistant text run as formatted markdown. The HTML is already
// sanitized by useMarkdown (raw HTML tokens dropped + hrefs sanitized at the AST),
// so v-html is safe here — same trust boundary as the desktop transcript.
const props = defineProps<{ src: string }>()

const { renderMarkdown } = useMarkdown()
const html = computed(() => renderMarkdown(props.src))
</script>

<template>
  <!-- v-html is safe: `html` is AST-sanitized in useMarkdown (raw HTML dropped). -->
  <div class="mdinline" v-html="html" />
</template>

<style scoped>
/* Ported from ui-next SessionMarkdownHtml.vue, theme tokens remapped to the PWA
   palette. v-html content is unscoped, so all selectors go through :deep(). */
.mdinline {
  line-height: 1.6;
  word-break: break-word;
}
.mdinline :deep(:first-child) {
  margin-top: 0;
}
.mdinline :deep(p) {
  margin: 0 0 10px;
}
.mdinline :deep(p:last-child),
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
  font-family: var(--mono);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 4px;
  font-size: 0.92em;
  overflow-wrap: anywhere;
}
.mdinline :deep(pre) {
  position: relative;
  margin: 0 0 10px;
  padding: 10px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow-x: auto;
  line-height: 1.5;
}
/* Shiki emits inline colors on a <pre class="shiki"> — clear its own bg so the
   .mdinline pre chrome shows through, matching desktop. */
.mdinline :deep(pre.shiki) {
  background: var(--surface-2) !important;
}
.mdinline :deep(pre code) {
  background: none;
  border: 0;
  padding: 0;
  font-size: 0.92em;
  white-space: pre;
}
.mdinline :deep(ul),
.mdinline :deep(ol) {
  margin: 0 0 10px;
  padding-left: 22px;
}
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
.mdinline :deep(ul:has(> li > input[type='checkbox'])) {
  list-style: none;
  padding-left: 0;
}
.mdinline :deep(li > input[type='checkbox']) {
  margin: 0 7px 0 0;
  vertical-align: middle;
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
  color: var(--text-dim);
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
  background: var(--surface-2);
  font-weight: 600;
}
.mdinline :deep(tbody tr:nth-child(even)) {
  background: color-mix(in srgb, var(--surface-2) 45%, transparent);
}
.mdinline :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  border: 1px solid var(--border);
}
/* KaTeX display equations scroll horizontally on narrow screens instead of overflowing. */
.mdinline :deep(.katex-display) {
  overflow-x: auto;
  overflow-y: hidden;
  padding: 2px 0;
}
</style>
