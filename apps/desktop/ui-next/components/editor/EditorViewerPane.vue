<template>
  <!-- Unified-diff view (read-only, line-colored). Ghim 12px để hàng không xê dịch theo
       Appearance; leading CHẴN cố định giữ mọi hàng trên lưới pixel. -->
  <div v-if="mode === 'diff'" :class="DIFF_PANE">
    <div
      v-for="(line, i) in diffLines"
      :key="i"
      class="px-3.5 whitespace-pre"
      :class="DIFF_LINE_CLASS[line.kind]"
    >
      {{ line.text || ' ' }}
    </div>
  </div>

  <!-- Rendered markdown preview (marked + mermaid; mirrors PreviewModal). -->
  <div
    v-else
    class="h-full min-w-0 overflow-hidden bg-muted"
    :class="isSplit ? 'w-1/2 flex-[0_0_50%] border-l' : 'flex-1'"
  >
    <div class="flex h-full flex-col items-center overflow-auto px-5.5 pt-6.5 pb-15">
      <!-- A file-path link in the doc opens in the shared PreviewModal; it must never
           reach the SPA router (dead route → full-page 404). See useMdFileLink. -->
      <div
        ref="mdBody"
        class="mdbody w-full max-w-220 leading-(--lh-prose) text-foreground"
        @click="onMdLinkClick"
      >
        <template v-for="(seg, i) in segments" :key="i">
          <MermaidView v-if="seg.type === 'mermaid'" :code="seg.code" />
          <pre v-else-if="seg.type === 'widget'" class="mmdstream"><code>{{ seg.code }}</code></pre>
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

// mono: nội dung diff
const DIFF_PANE =
  // px-ok: ghim 12px / leading 20px — diff không scale theo Appearance (xem comment template)
  'h-full min-w-0 flex-1 overflow-auto bg-background py-2 font-mono text-[12px] leading-[20px]'

const DIFF_LINE_CLASS: Record<DiffLine['kind'], string> = {
  add: 'bg-diff-add/10 text-diff-add',
  del: 'bg-diff-del/10 text-diff-del',
  hunk: 'text-primary',
  meta: 'text-faint',
  ctx: 'text-dim',
}

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
/* style-ok: HTML markdown render ra (v-html) — class không chạm tới được, chỉ :deep.
   Bám PreviewModal. */
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
  padding: 1px 5px;
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
