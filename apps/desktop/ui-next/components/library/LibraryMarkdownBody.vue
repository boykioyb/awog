<template>
  <div>
    <!-- hook-ok: `lmb-head`/`lmb-title` — pages/agents.vue + ConnectionDetail.vue :deep() bỏ margin/ẩn tiêu đề -->
    <div class="lmb-head mt-5 mb-2 flex items-center justify-between gap-2.5">
      <!-- hook-ok: xem trên -->
      <div class="lmb-title text-xs font-semibold text-dim">{{ title }}</div>
      <div class="flex items-center gap-1.5">
        <ToggleGroup
          type="single"
          :spacing="1"
          class="rounded-lg bg-muted p-0.5"
          :model-value="viewMode"
          @update:model-value="(v) => v && (viewMode = v as ViewMode)"
        >
          <ToggleGroupItem
            value="preview"
            class="h-6 px-2 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
          >
            {{ t('common.render') }}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="raw"
            class="h-6 px-2 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
          >
            {{ t('common.raw') }}
          </ToggleGroupItem>
        </ToggleGroup>
        <Button
          v-if="content"
          :title="copied ? t('library.md.copied') : t('common.copy')"
          variant="outline"
          size="sm"
          @click="onCopy"
        >
          <Icon :name="copied ? 'check' : 'copy'" />
          {{ copied ? t('library.md.copied') : t('common.copy') }}
        </Button>
        <Button
          v-if="allowEdit"
          :title="editTitle || t('library.md.edit')"
          variant="outline"
          size="sm"
          @click="onEdit"
        >
          <Icon name="sparkles" />
          {{ editLabel || t('library.md.edit') }}
        </Button>
      </div>
    </div>

    <div v-if="!content" class="rounded-lg border bg-muted p-3 text-sm text-faint italic">
      {{ emptyText || t('library.md.empty') }}
    </div>
    <!-- A file-path link in the body opens in the shared preview when a workspace root is
         known; either way the SPA router never sees it (dead route → 404).
         `mdbody` = prose markdown toàn cục (assets/css/markdown.css). -->
    <div
      v-else-if="viewMode === 'preview'"
      ref="mdBody"
      class="mdbody rounded-lg border bg-muted px-4 py-3 text-foreground"
      @click="onMdLinkClick"
    >
      <template v-for="(seg, i) in segments" :key="i">
        <MermaidView v-if="seg.type === 'mermaid'" :code="seg.code" />
        <pre v-else-if="seg.type === 'widget'"><code>{{ seg.code }}</code></pre>
        <!-- eslint-disable-next-line vue/no-v-html -- sanitized in useMarkdown -->
        <div v-else v-html="seg.html" />
      </template>
    </div>
    <!-- mono-ok: nội dung markdown thô của file -->
    <pre
      v-else
      class="m-0 rounded-lg border bg-muted p-3 font-mono text-sm whitespace-pre-wrap text-muted-foreground"
      >{{ content }}</pre
    >
  </div>
</template>

<script setup lang="ts">
// Shared section header + markdown body with preview/raw toggle, copy, and an
// optional edit trigger. Port of the old UI MarkdownBodyView — used by every
// library detail (Skill SKILL.md, Agent system prompt, …). Renders via the
// ui-next useMarkdown composable (sanitized AST → :deep prose, mermaid blocks
// live); prose đi qua `.mdbody` toàn cục (assets/css/markdown.css).
import { computed, ref } from 'vue'
import MermaidView from '~/components/common/MermaidView.vue'
import { useCodeBlockControls } from '~/composables/useCodeBlockControls'
import { useMarkdown } from '~/composables/useMarkdown'
import { useMdFileLink } from '~/composables/useMdFileLink'
import Button from '~/components/ui/button/Button.vue'
import ToggleGroup from '~/components/ui/toggle-group/ToggleGroup.vue'
import ToggleGroupItem from '~/components/ui/toggle-group/ToggleGroupItem.vue'

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
useCodeBlockControls(mdBody, () => segments.value)

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
