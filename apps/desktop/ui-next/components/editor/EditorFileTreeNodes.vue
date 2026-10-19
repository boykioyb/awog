<template>
  <div>
    <template v-for="node in nodes" :key="node.path">
      <!-- raw-ok: hàng cây file — cả dòng là vùng bấm, thụt lề theo depth -->
      <button
        type="button"
        class="flex w-full cursor-pointer items-center gap-1.5 border-l-2 py-1 pr-2.5 text-left text-foreground hover:bg-accent"
        :class="
          node.kind === 'file' && node.path === selectedPath
            ? 'border-l-primary bg-selected'
            : 'border-l-transparent'
        "
        :style="{ paddingLeft: `${depth * 12 + 10}px` }"
        @click="onClick(node)"
        @contextmenu.prevent="ctrl.onContext?.($event, node.path, node.kind)"
      >
        <Icon
          v-if="node.kind === 'dir'"
          name="chev"
          class="size-3 shrink-0 text-faint transition-transform"
          :class="{ '-rotate-90': !ctrl.isExpanded(node.path) }"
        />
        <span v-else class="size-3 shrink-0" />
        <Icon :name="node.kind === 'dir' ? 'folder' : 'text'" class="size-3.5 shrink-0 text-dim" />
        <!-- mono: tên file/thư mục trong cây -->
        <span class="min-w-0 truncate font-mono">{{ node.name }}</span>
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
