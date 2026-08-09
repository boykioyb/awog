<template>
  <div class="lmb">
    <div class="lmb-head">
      <div class="sech lmb-title">{{ title }}</div>
      <div class="lmb-actions">
        <div class="seg lmb-seg">
          <span :class="{ on: viewMode === 'preview' }" @click="viewMode = 'preview'">
            {{ t('common.render') }}
          </span>
          <span :class="{ on: viewMode === 'raw' }" @click="viewMode = 'raw'">
            {{ t('common.raw') }}
          </span>
        </div>
        <button
          v-if="content"
          class="btn sm"
          :title="copied ? t('library.md.copied') : t('common.copy')"
          @click="onCopy"
        >
          <Icon :name="copied ? 'check' : 'copy'" />
          {{ copied ? t('library.md.copied') : t('common.copy') }}
        </button>
        <button
          v-if="allowEdit"
          class="btn sm"
          :title="editTitle || t('library.md.edit')"
          @click="onEdit"
        >
          <Icon name="sparkles" />
          {{ editLabel || t('library.md.edit') }}
        </button>
      </div>
    </div>

    <div v-if="!content" class="lmb-empty">{{ emptyText || t('library.md.empty') }}</div>
    <!-- A file-path link in the body opens in the shared preview when a workspace root is
         known; either way the SPA router never sees it (dead route → 404). -->
    <div
      v-else-if="viewMode === 'preview'"
      ref="mdBody"
      class="lmb-render mdbody"
      @click="onMdLinkClick"
    >
      <template v-for="(seg, i) in segments" :key="i">
        <MermaidView v-if="seg.type === 'mermaid'" :code="seg.code" />
        <!-- eslint-disable-next-line vue/no-v-html -- sanitized in useMarkdown -->
        <div v-else v-html="seg.html" />
      </template>
    </div>
    <pre v-else class="codeblk lmb-raw">{{ content }}</pre>
  </div>
</template>

<script setup lang="ts">
// Shared section header + markdown body with preview/raw toggle, copy, and an
// optional edit trigger. Port of the old UI MarkdownBodyView — used by every
// library detail (Skill SKILL.md, Agent system prompt, …). Renders via the
// ui-next useMarkdown composable (sanitized AST → :deep prose, mermaid blocks
// live), styled in prototype CSS.
import { computed, ref } from 'vue'
import MermaidView from '~/components/common/MermaidView.vue'
import { useCodeCopy } from '~/composables/useCodeCopy'
import { useMarkdown } from '~/composables/useMarkdown'
import { useMdFileLink } from '~/composables/useMdFileLink'

const props = withDefaults(
  defineProps<{
    title: string
    content: string
    emptyText?: string
    allowEdit?: boolean
    editLabel?: string
    editTitle?: string
    // Absolute workspace root the body's file-path links are anchored at, when the
    // caller knows one (a project-scoped doc). Null → links are inert (a skill/agent
    // body references files in no particular project).
    workspaceRoot?: string | null
  }>(),
  { emptyText: '', allowEdit: false, editLabel: '', editTitle: '', workspaceRoot: null },
)

// Emits the click anchor (button rect) so the caller can position a creator
// popover next to the Edit button — mirrors the old UI.
const emit = defineEmits<{ 'edit-body': [anchor: { top: number; left: number } | null] }>()

const { t } = useI18n()
const { renderMarkdown } = useMarkdown()
const { onMdLinkClick } = useMdFileLink(() => props.workspaceRoot)

type ViewMode = 'preview' | 'raw'
const viewMode = ref<ViewMode>('preview')
const copied = ref(false)

const segments = computed(() => renderMarkdown(props.content ?? ''))

// Per-code-block copy button (the header's Copy button copies the WHOLE body).
const mdBody = useTemplateRef<HTMLElement>('mdBody')
useCodeCopy(mdBody, () => segments.value)

const onCopy = async () => {
  try {
    await navigator.clipboard.writeText(props.content ?? '')
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    // Clipboard API can fail under non-secure contexts — fall back to the
    // legacy execCommand path the webview tolerates.
    const textarea = document.createElement('textarea')
    textarea.value = props.content ?? ''
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand('copy')
      copied.value = true
      setTimeout(() => {
        copied.value = false
      }, 1500)
    } finally {
      document.body.removeChild(textarea)
    }
  }
}

const onEdit = (e: MouseEvent) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  emit('edit-body', { top: rect.bottom + 8, left: rect.left })
}
</script>

<style scoped>
.lmb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 20px 0 9px;
}
.lmb-title {
  margin: 0;
}
.lmb-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.lmb-seg span {
  font-size: 0.8462rem;
  padding: 4px 9px;
}
.lmb-empty {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 13px;
  font-size: 0.9231rem;
  color: var(--textFaint);
  font-style: italic;
}
.lmb-render {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 13px 15px;
  line-height: 1.7;
  color: var(--text);
}
.lmb-raw {
  margin: 0;
}

/* Rendered markdown prose (v-html → :deep), mirrors PreviewModal's .mdbody. */
.mdbody :deep(h1),
.mdbody :deep(h2),
.mdbody :deep(h3) {
  font-weight: 700;
  line-height: 1.3;
  margin: 1.1em 0 0.5em;
}
.mdbody :deep(h1) {
  font-size: 1.4em;
}
.mdbody :deep(h2) {
  font-size: 1.2em;
}
.mdbody :deep(h3) {
  font-size: 1.08em;
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
.mdbody :deep(pre) {
  background: var(--bgSubtle);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  overflow-x: auto;
  line-height: 1.6;
}
.mdbody :deep(pre code) {
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
</style>
