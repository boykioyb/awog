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
      <!-- A file-path link in the doc opens in the shared PreviewModal; it must never
           reach the SPA router (dead route → full-page 404). See useMdFileLink. -->
      <div ref="mdBody" class="mdbody" @click="onMdLinkClick">
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
import { useCodeBlockControls } from '~/composables/useCodeBlockControls'
import { useMarkdown } from '~/composables/useMarkdown'
import type { MdSegment } from '~/composables/useMarkdown'
import { useMdFileLink } from '~/composables/useMdFileLink'

const props = withDefaults(
  defineProps<{
    content: string
    mode: 'diff' | 'preview'
    isSplit?: boolean
    // Absolute root of the task's project — a `backend/app/x.py` link in the artifact
    // resolves under it and opens in the shared PreviewModal. Null while the project
    // is still resolving (or unknown): the link click is then simply inert.
    workspaceRoot?: string | null
  }>(),
  { isSplit: false, workspaceRoot: null },
)

const { renderMarkdown } = useMarkdown()
const { onMdLinkClick } = useMdFileLink(() => props.workspaceRoot)

const segments = computed<MdSegment[]>(() =>
  props.mode === 'preview' ? renderMarkdown(props.content) : [],
)

// Per-code-block copy button, same control as the transcript / preview modal.
const mdBody = useTemplateRef<HTMLElement>('mdBody')
useCodeBlockControls(mdBody, () => segments.value)

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
  /* design-token-ok: the diff pane pins 12px so rows stay put across Appearance; a
     fixed leading keeps every row on the pixel grid. */
  line-height: 19px;
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
  line-height: var(--lh-prose);
  color: var(--text);
}
.mdbody :deep(h1),
.mdbody :deep(h2),
.mdbody :deep(h3) {
  font-weight: 700;
  /* design-token-ok: heading font-size is em-relative (ADR 0079 leaves `em` alone), so
     no single whole-pixel leading exists for the whole h1…h6 group. */
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
  padding: 1px 4px;
  border-radius: var(--r-xs);
}
.mdbody :deep(pre) {
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 12px 14px;
  overflow-x: auto;
  line-height: var(--lh-sm);
}
.mdbody :deep(pre code) {
  background: none;
  padding: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
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
/* Code token colors come from Shiki inline styles (ADR 0055). */
</style>
