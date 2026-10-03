<template>
  <div class="proto-md text-sm leading-relaxed text-foreground/90">
    <template v-for="(seg, i) in segments" :key="i">
      <ProtoMermaid v-if="seg.type === 'mermaid'" :code="seg.code" />
      <pre v-else-if="seg.type === 'widget'" class="proto-md-code"><code>{{ seg.code }}</code></pre>
      <!-- eslint-disable-next-line vue/no-v-html -- sanitized in useMarkdown -->
      <div v-else v-html="seg.html" />
    </template>
  </div>
</template>

<script setup lang="ts">
// Rendered markdown for the proto — the REAL pipeline: marked + Shiki +
// KaTeX + sanitization, split into html/mermaid/widget segments by
// useMarkdown().renderMarkdown (the same composable the production
// transcript uses via SessionMarkdownHtml).
import { computed } from 'vue'
import { useMarkdown } from '~/composables/useMarkdown'

const props = defineProps<{ src: string }>()
const { renderMarkdown } = useMarkdown()
const segments = computed(() => renderMarkdown(props.src))
</script>

<style scoped>
/* Prose rules for the sanitized html segments — mirrors the density of
   SessionMarkdownHtml: compact lists, code chips, hairline blockquote/table. */
.proto-md :deep(p) {
  margin: 0 0 8px;
}
.proto-md :deep(strong) {
  font-weight: 650;
  color: var(--foreground);
}
.proto-md :deep(em) {
  font-style: italic;
}
.proto-md :deep(a) {
  color: var(--primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.proto-md :deep(ul),
.proto-md :deep(ol) {
  margin: 0 0 8px;
  padding-left: 20px;
}
.proto-md :deep(li) {
  margin: 2px 0;
}
.proto-md :deep(h1),
.proto-md :deep(h2),
.proto-md :deep(h3),
.proto-md :deep(h4) {
  margin: 12px 0 6px;
  font-weight: 650;
  color: var(--foreground);
  line-height: var(--lh-lg);
}
.proto-md :deep(h1) {
  font-size: 1.25em;
}
.proto-md :deep(h2) {
  font-size: 1.12em;
}
.proto-md :deep(h3),
.proto-md :deep(h4) {
  font-size: 1em;
}
.proto-md :deep(blockquote) {
  margin: 0 0 8px;
  padding-left: 12px;
  border-left: 2px solid var(--border);
  color: var(--muted-foreground);
}
.proto-md :deep(code) {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.9em;
  background: var(--muted);
  padding: 1px 5px;
  border-radius: var(--r-xs);
}
.proto-md :deep(pre) {
  margin: 0 0 8px;
  padding: 10px 12px;
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow-x: auto;
}
.proto-md :deep(pre code) {
  background: none;
  padding: 0;
}
.proto-md :deep(table) {
  margin: 0 0 8px;
  border-collapse: collapse;
  font-size: 0.92em;
}
.proto-md :deep(th),
.proto-md :deep(td) {
  border: 1px solid var(--border);
  padding: 4px 10px;
  text-align: left;
}
.proto-md :deep(th) {
  background: var(--muted);
  font-weight: 600;
}
.proto-md :deep(img) {
  max-width: 100%;
  border-radius: var(--radius);
  border: 1px solid var(--border);
}
.proto-md :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 12px 0;
}
.proto-md :deep(> *:last-child),
.proto-md :deep(li > *:last-child) {
  margin-bottom: 0;
}
.proto-md-code {
  margin: 0;
  padding: 10px 12px;
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow-x: auto;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.85em;
}
</style>
