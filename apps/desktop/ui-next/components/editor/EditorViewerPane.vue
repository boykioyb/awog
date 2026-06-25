<template>
  <!-- Unified-diff view (read-only, line-colored). -->
  <div v-if="mode === 'diff'" class="edview-diff">
    <div v-for="(line, i) in diffLines" :key="i" class="edview-diffline" :class="line.kind">
      {{ line.text || ' ' }}
    </div>
  </div>

  <!-- Rendered markdown preview (marked + mermaid; mirrors PreviewModal). -->
  <div v-else class="edview-md" :class="{ split: isSplit }">
    <div class="edview-mdscroll">
      <div class="mdbody">
        <template v-for="(seg, i) in segments" :key="i">
          <MermaidView v-if="seg.type === 'mermaid'" :code="seg.code" />
          <!-- eslint-disable-next-line vue/no-v-html -- sanitized in useMarkdown -->
          <div v-else v-html="seg.html" />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Read-only viewer pane for the Task Artifact Editor.
//   'diff'    → unified-diff text rendered line-by-line with +/− coloring.
//   'preview' → markdown rendered via useMarkdown (raw HTML stripped) + live
//               mermaid diagrams, styled like the shared PreviewModal prose.
import MermaidView from '~/components/common/MermaidView.vue'
import { useMarkdown } from '~/composables/useMarkdown'
import type { MdSegment } from '~/composables/useMarkdown'

const props = withDefaults(
  defineProps<{
    content: string
    mode: 'diff' | 'preview'
    isSplit?: boolean
  }>(),
  { isSplit: false },
)

const { renderMarkdown } = useMarkdown()

const segments = computed<MdSegment[]>(() =>
  props.mode === 'preview' ? renderMarkdown(props.content) : [],
)

type DiffLine = { text: string; kind: 'add' | 'del' | 'hunk' | 'meta' | 'ctx' }

// Classify each unified-diff line for coloring. Mirrors the diffStats regexes used
// in the page so the visual matches the header count.
const diffLines = computed<DiffLine[]>(() => {
  if (props.mode !== 'diff') return []
  return props.content.split('\n').map<DiffLine>((text) => {
    if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('diff '))
      return { text, kind: 'meta' }
    if (text.startsWith('@@')) return { text, kind: 'hunk' }
    if (text.startsWith('+')) return { text, kind: 'add' }
    if (text.startsWith('-')) return { text, kind: 'del' }
    return { text, kind: 'ctx' }
  })
})
</script>

<style scoped>
.edview-diff {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: auto;
  background: var(--bg);
  font-family: var(--code);
  font-size: 12px;
  line-height: 1.6;
  padding: 8px 0;
}
.edview-diffline {
  white-space: pre;
  padding: 0 14px;
  color: var(--textDim);
}
.edview-diffline.add {
  background: var(--addBg);
  color: var(--add);
}
.edview-diffline.del {
  background: var(--dangerDim);
  color: var(--danger);
}
.edview-diffline.hunk {
  color: var(--accent);
}
.edview-diffline.meta {
  color: var(--textFaint);
}

.edview-md {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  background: var(--bgSubtle);
}
.edview-md.split {
  flex: 0 0 50%;
  width: 50%;
  border-left: 1px solid var(--border);
}
.edview-mdscroll {
  height: 100%;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 26px 22px 60px;
}

/* Rendered markdown prose (v-html content → :deep), mirrors PreviewModal. */
.mdbody {
  width: 100%;
  max-width: 880px;
  line-height: 1.7;
  color: var(--text);
}
.mdbody :deep(h1),
.mdbody :deep(h2),
.mdbody :deep(h3) {
  font-weight: 700;
  line-height: 1.3;
  margin: 1.1em 0 0.5em;
}
.mdbody :deep(h1) {
  font-size: 1.6em;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.3em;
}
.mdbody :deep(h2) {
  font-size: 1.35em;
}
.mdbody :deep(h3) {
  font-size: 1.15em;
}
.mdbody :deep(p),
.mdbody :deep(ul),
.mdbody :deep(ol),
.mdbody :deep(blockquote),
.mdbody :deep(table) {
  margin: 0.6em 0;
}
.mdbody :deep(ul),
.mdbody :deep(ol) {
  padding-left: 1.5em;
}
.mdbody :deep(ul) {
  list-style: disc;
}
.mdbody :deep(ol) {
  list-style: decimal;
}
.mdbody :deep(li) {
  margin: 0.2em 0;
}
.mdbody :deep(a) {
  color: var(--accent);
  text-decoration: underline;
}
.mdbody :deep(code) {
  font-family: var(--code);
  font-size: 0.9em;
  background: var(--bgActive);
  padding: 1px 5px;
  border-radius: 4px;
}
.mdbody :deep(pre.hljs) {
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  overflow-x: auto;
  line-height: 1.6;
}
.mdbody :deep(pre.hljs code) {
  background: none;
  padding: 0;
  font-size: 0.8846rem;
}
.mdbody :deep(blockquote) {
  border-left: 3px solid var(--border);
  padding-left: 1em;
  color: var(--textMuted);
}
.mdbody :deep(table) {
  border-collapse: collapse;
  width: 100%;
}
.mdbody :deep(th),
.mdbody :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 10px;
  text-align: left;
}
.mdbody :deep(th) {
  background: var(--bgActive);
}
.mdbody :deep(hr) {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 1.2em 0;
}
.mdbody :deep(img) {
  max-width: 100%;
}
.mdbody :deep(.hljs-keyword),
.mdbody :deep(.hljs-built_in) {
  color: var(--violet);
}
.mdbody :deep(.hljs-string),
.mdbody :deep(.hljs-attr) {
  color: var(--add);
}
.mdbody :deep(.hljs-comment) {
  color: var(--textFaint);
  font-style: italic;
}
.mdbody :deep(.hljs-number),
.mdbody :deep(.hljs-literal) {
  color: var(--amber);
}
.mdbody :deep(.hljs-title),
.mdbody :deep(.hljs-title.function_),
.mdbody :deep(.hljs-section) {
  color: var(--blue);
}
</style>
