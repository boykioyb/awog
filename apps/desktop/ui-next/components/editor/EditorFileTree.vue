<template>
  <div class="edtree">
    <div class="edtree-head">{{ t('editor.explorer') }}</div>
    <div class="edtree-body">
      <EditorFileTreeNodes
        :nodes="ctrl.childrenFor('')"
        :depth="0"
        :ctrl="ctrl"
        :selected-path="selectedPath"
      />
      <div v-if="!ctrl.childrenFor('').length && !ctrl.loading.value" class="edtree-empty">
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

<style scoped>
.edtree {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bgPanel);
}
.edtree-head {
  padding: 9px 12px;
  font-size: 12px;
  color: var(--textDim);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.edtree-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0 10px;
}
.edtree-empty {
  padding: 18px 14px;
  color: var(--textFaint);
}
</style>
