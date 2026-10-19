<template>
  <div class="flex h-full min-w-0 flex-1 flex-col">
    <header class="flex items-center gap-2 border-b px-2.5 py-1.5">
      <!-- mono-ok: đường dẫn trang wiki -->
      <span class="min-w-0 flex-1 truncate font-mono text-sm text-faint">{{ path }}</span>
      <div class="flex gap-1.5">
        <Button :disabled="saving" variant="outline" size="sm" @click="emit('cancel')">
          {{ t('common.cancel') }}
        </Button>
        <Button :disabled="saving || !dirty" variant="default" size="sm" @click="emit('save')">
          <Icon name="save" class="size-3.5" />
          {{ saving ? t('common.saving') : t('common.save') }}
        </Button>
      </div>
    </header>

    <div class="flex flex-wrap gap-2 px-2.5 py-2">
      <label class="flex min-w-0 flex-1 basis-55 flex-col gap-0.5">
        <span class="text-xs font-semibold text-dim">{{ t('wiki.editor.title') }}</span>
        <Input :model-value="draft.title" @update:model-value="update('title', $event)" />
      </label>
      <label class="flex min-w-0 flex-1 basis-55 flex-col gap-0.5">
        <span class="text-xs font-semibold text-dim">{{ t('wiki.editor.description') }}</span>
        <Input
          :model-value="draft.description"
          :placeholder="derivedDescription || t('wiki.editor.descriptionHint')"
          @update:model-value="update('description', $event)"
        />
      </label>
      <label class="flex min-w-0 flex-none shrink basis-45 flex-col gap-0.5">
        <span class="text-xs font-semibold text-dim">{{ t('wiki.editor.tags') }}</span>
        <Input
          :model-value="draft.tags"
          placeholder="architecture, ipc"
          @update:model-value="update('tags', $event)"
        />
      </label>
      <label
        class="flex cursor-pointer items-center gap-1.5 self-end text-base text-dim"
        :title="t('wiki.editor.contextHint')"
      >
        <Checkbox
          :model-value="draft.context"
          @update:model-value="(v) => update('context', v === true)"
        />
        <span>{{ t('wiki.editor.context') }}</span>
      </label>
    </div>

    <div
      class="mx-2.5 mb-2.5 min-h-0 flex-1 overflow-hidden rounded-md border"
      @keydown="onKeydown"
    >
      <MonacoEditor
        ref="editorRef"
        :path="modelPath"
        @ready="onEditorReady"
        @change="onEditorChange"
        @save="emit('save')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// Wiki page editor: frontmatter fields (title / description / tags / LLM
// visibility) plus the Markdown body in Monaco. ⌘S / Ctrl+S saves (Monaco emits
// `save` for the in-editor chord; the wrapper handles it for the meta fields).
//
// `description` gets its own field rather than being derived, because it is what
// the LLM sees in <wiki_index> — it is the one line that decides whether the model
// opens this page at all (ADR 0073 D-5).
//
// Monaco's API is imperative (openFile/setValue keyed by a model path), so the
// body is pushed IN on open/page-switch and pulled OUT via `change` — the parent
// keeps owning the draft. The model key is prefixed so a wiki page and a
// same-named workspace file never share an undo stack.
import { defineAsyncComponent, onMounted, ref, watch } from 'vue'
import type { MonacoEditorHandle } from '~/components/editor/types'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import Checkbox from '~/components/ui/checkbox/Checkbox.vue'

// Monaco is loaded only when the user actually edits. A static import would put the
// editor AND its five `?worker` bundles into the /wiki page graph, so merely READING
// a page — the page's main job — would pay for the editor. The imperative handle
// still resolves through the template ref once the chunk lands.
const MonacoEditor = defineAsyncComponent(() => import('~/components/common/MonacoEditor.vue'))

export interface WikiDraft {
  title: string
  description: string
  tags: string
  context: boolean
  body: string
}

const props = withDefaults(
  defineProps<{
    path: string
    draft: WikiDraft
    dirty: boolean
    saving: boolean
    // What the LLM index currently shows when the page has no authored description —
    // displayed as the field's placeholder, never as a value.
    derivedDescription?: string
  }>(),
  { derivedDescription: '' },
)

const emit = defineEmits<{
  save: []
  cancel: []
  'update:draft': [draft: WikiDraft]
}>()

const { t } = useI18n()

const editorRef = useTemplateRef<MonacoEditorHandle>('editorRef')
const ready = ref(false)
// Monaco model key. Namespaced away from workspace file paths so a wiki page and a
// same-named repo file never share an undo stack. NO colon: MonacoEditor builds the
// model URI as `Uri.parse('file:///' + path)`, and a colon inside a file-URI path is
// exactly where drive-letter normalisation lives — `wiki/` sidesteps that entirely.
const modelPath = computed(() => `__wiki__/${props.path}`)

function update<K extends keyof WikiDraft>(key: K, value: WikiDraft[K]): void {
  emit('update:draft', { ...props.draft, [key]: value })
}

// Push the body into Monaco. Called on ready and whenever the open page changes;
// NOT on every draft keystroke, which would fight the user's cursor.
function pushBody(): void {
  if (!ready.value) return
  editorRef.value?.openFile(modelPath.value, props.draft.body, 'markdown')
}

function onEditorReady(): void {
  ready.value = true
  pushBody()
}

function onEditorChange(payload: { path: string; value: string }): void {
  if (payload.path !== modelPath.value) return
  update('body', payload.value)
}

watch(modelPath, () => pushBody())
onMounted(() => pushBody())

// ⌘S outside Monaco (the meta fields). Inside the editor Monaco owns the chord
// and emits `save` itself.
function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    emit('save')
  }
}
</script>
