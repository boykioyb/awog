<template>
  <div class="weditor">
    <header class="we-head" :style="{ borderBottom: '1px solid var(--border)' }">
      <span class="we-path" :style="{ color: 'var(--textFaint)' }">{{ path }}</span>
      <div class="we-actions">
        <button class="btn sm" :disabled="saving" @click="emit('cancel')">
          {{ t('common.cancel') }}
        </button>
        <button class="btn sm pri" :disabled="saving || !dirty" @click="emit('save')">
          <Icon name="save" :size="13" />
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </header>

    <div class="we-meta">
      <label class="we-field">
        <span class="sech">{{ t('wiki.editor.title') }}</span>
        <input
          :value="draft.title"
          class="we-input"
          @input="update('title', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="we-field">
        <span class="sech">{{ t('wiki.editor.description') }}</span>
        <input
          :value="draft.description"
          class="we-input"
          :placeholder="derivedDescription || t('wiki.editor.descriptionHint')"
          @input="update('description', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="we-field short">
        <span class="sech">{{ t('wiki.editor.tags') }}</span>
        <input
          :value="draft.tags"
          class="we-input"
          placeholder="architecture, ipc"
          @input="update('tags', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="we-toggle" :title="t('wiki.editor.contextHint')">
        <input
          type="checkbox"
          :checked="draft.context"
          @change="update('context', ($event.target as HTMLInputElement).checked)"
        />
        <span>{{ t('wiki.editor.context') }}</span>
      </label>
    </div>

    <div class="we-body" @keydown="onKeydown">
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

<style scoped>
.weditor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  height: 100%;
}
.we-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
}
.we-path {
  flex: 1;
  min-width: 0;
  /* mono-ok: wiki page path */
  font-family: var(--code);
  font-size: 12px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.we-actions {
  display: flex;
  gap: 6px;
}
.we-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 10px;
}
.we-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 220px;
  min-width: 0;
}
.we-field.short {
  flex: 0 1 180px;
}
.we-input {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--text);
  padding: 4px 6px;
  font-size: 1em;
  outline: none;
}
.we-input:focus {
  border-color: var(--borderFocus);
}
.we-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  align-self: flex-end;
  color: var(--textDim);
  font-size: 1em;
  cursor: pointer;
}
.we-body {
  flex: 1;
  min-height: 0;
  margin: 0 10px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  overflow: hidden;
}
</style>
