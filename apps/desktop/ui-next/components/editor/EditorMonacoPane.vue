<template>
  <div class="edpane" :class="{ split: isSplit }">
    <MonacoEditor
      ref="editorRef"
      :path="path"
      :read-only="readOnly"
      @ready="emit('ready')"
      @change="(p) => emit('change', p)"
      @save="emit('save')"
      @cursor-change="(c) => emit('cursor-change', c)"
    />
  </div>
</template>

<script setup lang="ts">
// Thin wrapper around the multi-tab MonacoEditor — fills the editor area (full or
// half width in split view) and forwards the imperative open/close/getValue API to
// the parent via a typed exposed handle. Re-exposing keeps the page's editorRef
// pointed at the real editor through one extra layer.
import MonacoEditor from '~/components/common/MonacoEditor.vue'
import type { MonacoEditorHandle } from '~/components/editor/types'

defineProps<{
  // Active model key (workspace-relative path). Empty = nothing open.
  path: string
  readOnly?: boolean
  // When true (split view), the pane uses half width with a divider.
  isSplit?: boolean
}>()

const emit = defineEmits<{
  ready: []
  change: [payload: { path: string; value: string }]
  save: []
  'cursor-change': [pos: { line: number; column: number }]
}>()

// Re-expose the editor handle so the page can drive openFile/closeFile/getValue.
const editorRef = useTemplateRef<MonacoEditorHandle>('editorRef')

defineExpose({
  openFile: (path: string, content: string, language?: string) =>
    editorRef.value?.openFile(path, content, language),
  closeFile: (path: string) => editorRef.value?.closeFile(path),
  getValue: (path: string) => editorRef.value?.getValue(path) ?? '',
  setValue: (path: string, content: string) => editorRef.value?.setValue(path, content),
  revealPosition: (path: string, line: number, column: number) =>
    editorRef.value?.revealPosition(path, line, column),
  focus: () => editorRef.value?.focus(),
})
</script>

<style scoped>
.edpane {
  height: 100%;
  min-width: 0;
  flex: 1;
}
.edpane.split {
  flex: 0 0 50%;
  width: 50%;
  border-right: 1px solid var(--border);
}
</style>
