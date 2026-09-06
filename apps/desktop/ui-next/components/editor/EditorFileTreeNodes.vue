<template>
  <div class="edtn">
    <template v-for="node in nodes" :key="node.path">
      <button
        class="edtn-row"
        :class="{ on: node.kind === 'file' && node.path === selectedPath }"
        :style="{ paddingLeft: `${depth * 12 + 10}px` }"
        @click="onClick(node)"
        @contextmenu.prevent="ctrl.onContext?.($event, node.path, node.kind)"
      >
        <Icon
          v-if="node.kind === 'dir'"
          name="chev"
          class="edtn-chev"
          :class="{ open: ctrl.isExpanded(node.path) }"
        />
        <span v-else class="edtn-chev-spacer" />
        <Icon :name="node.kind === 'dir' ? 'folder' : 'text'" class="edtn-icon" />
        <span class="edtn-name">{{ node.name }}</span>
      </button>

      <!-- Recursively render an expanded directory's children. -->
      <EditorFileTreeNodes
        v-if="node.kind === 'dir' && ctrl.isExpanded(node.path)"
        :nodes="ctrl.childrenFor(node.path)"
        :depth="depth + 1"
        :ctrl="ctrl"
        :selected-path="selectedPath"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
// Recursive node list for EditorFileTree. Dirs toggle their expansion (lazy load
// via the controller); files open in the editor. Indentation scales with depth.
import type { WorkspaceTreeNode } from '~/composables/useWorkspaceFiles'
import type { FileTreeController } from '~/components/editor/file-tree-controller'

const props = defineProps<{
  nodes: WorkspaceTreeNode[]
  depth: number
  ctrl: FileTreeController
  selectedPath: string | null
}>()

function onClick(node: WorkspaceTreeNode): void {
  if (node.kind === 'dir') props.ctrl.toggle(node.path)
  else props.ctrl.openFile(node.path)
}
</script>

<style scoped>
.edtn-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 10px 4px 10px;
  text-align: left;
  color: var(--text);
  background: transparent;
  border: none;
  border-left: 2px solid transparent;
  cursor: pointer;
}
.edtn-row:hover {
  background: var(--bgHover);
}
.edtn-row.on {
  background: var(--bgActive);
  border-left-color: var(--accent);
}
.edtn-chev {
  width: var(--icon-xs);
  height: var(--icon-xs);
  color: var(--textFaint);
  flex-shrink: 0;
  transform: rotate(-90deg);
  transition: transform 0.12s;
}
.edtn-chev.open {
  transform: rotate(0deg);
}
.edtn-chev-spacer {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}
.edtn-icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--textDim);
  flex-shrink: 0;
}
.edtn-name {
  /* mono-ok: file tree node name */
  font-family: var(--code);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
</style>
