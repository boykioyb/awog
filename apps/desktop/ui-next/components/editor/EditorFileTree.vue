<template>
  <div class="flex h-full min-h-0 flex-col bg-sidebar">
    <div class="shrink-0 border-b px-3 py-2 text-sm text-dim">{{ t('editor.explorer') }}</div>
    <div class="min-h-0 flex-1 overflow-y-auto pt-1 pb-2.5">
      <EditorFileTreeNodes
        :nodes="ctrl.childrenFor('')"
        :depth="0"
        :ctrl="ctrl"
        :selected-path="selectedPath"
      />
      <div
        v-if="!ctrl.childrenFor('').length && !ctrl.loading.value"
        class="px-3.5 py-4.5 text-faint"
      >
        {{ t('editor.emptyTree') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// File-tree explorer for the Project Code Workspace (prototype CSS). Recursive via
// EditorFileTreeNodes; lazy-loads a directory's children on expand through the
// controller (useWorkspaceFiles). Clicking a file emits its workspace-relative
// path so the page opens it in a tab.
import EditorFileTreeNodes from '~/components/editor/EditorFileTreeNodes.vue'
import type { FileTreeController } from '~/components/editor/file-tree-controller'

defineProps<{
  ctrl: FileTreeController
  selectedPath: string | null
}>()

const { t } = useI18n()
</script>
