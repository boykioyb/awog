<template>
  <template v-for="(n, i) in nodes" :key="i">
    <div
      v-if="'f' in n"
      class="frow file"
      :style="isSelected(path(n.f)) ? { background: 'var(--bgActive)' } : undefined"
      @click="onFile(path(n.f))"
      @contextmenu.prevent="ctrl.onContext?.($event, path(n.f), 'file')"
    >
      <span class="fst" :class="{ m: n.st === 'M', a: n.st === 'A' }">{{ n.st || '' }}</span>
      <Icon name="rules" style="width: 12px; height: 12px" />
      <span class="fn">{{ n.f }}</span>
    </div>
    <template v-else>
      <div
        class="frow dir"
        @click="onDir(path(n.d))"
        @contextmenu.prevent="ctrl.onContext?.($event, path(n.d), 'dir')"
      >
        <Icon name="chev" class="fchv" :class="{ col: !isOpen(path(n.d)) }" />
        <Icon name="folder" style="width: 12px; height: 12px" />
        <span class="fdn">{{ n.d }}</span>
      </div>
      <div v-if="isOpen(path(n.d))" class="fchild">
        <SessionFileTree :nodes="childrenOf(n) || []" :prefix="path(n.d)" :ctrl="ctrl" />
      </div>
    </template>
  </template>
</template>

<script lang="ts">
// Controller contract, declared in a plain <script> block so the recursive
// instances share one type import site.
import type { Ref } from 'vue'
import type { TreeDir, TreeNode } from '~/composables/useSessionsData'

// The owner of the tree (Files tab / PreviewModal folder view) holds expand +
// select state and lazily loads a directory's children. This component is purely
// the recursive markup — it keeps no state of its own, so there is no second
// "sample tree" mode that could render a folder the user does not have.
export type FileTreeController = {
  isOpen: (path: string) => boolean
  toggle: (path: string) => void
  selectedPath: Ref<string | null>
  selectFile: (path: string) => void
  // Lazy children for a directory path (already-loaded entries).
  childrenFor: (path: string) => TreeNode[]
  // Right-click a row → open the shared file context menu.
  onContext?: (e: MouseEvent, path: string, kind: 'file' | 'dir') => void
}
</script>

<script setup lang="ts">
// Recursive workspace file tree (treeHtml ~1395). Self-references via global
// auto-import; every instance defers expand/select/lazy-load to `ctrl`.
const props = withDefaults(
  defineProps<{ nodes: TreeNode[]; prefix?: string; ctrl: FileTreeController }>(),
  {
    prefix: '',
  },
)

const path = (name: string) => (props.prefix ? `${props.prefix}/${name}` : name)

const isOpen = (p: string): boolean => props.ctrl.isOpen(p)
const isSelected = (p: string): boolean => props.ctrl.selectedPath.value === p
const childrenOf = (n: TreeDir): TreeNode[] => props.ctrl.childrenFor(path(n.d))

function onDir(p: string): void {
  props.ctrl.toggle(p)
}
function onFile(p: string): void {
  props.ctrl.selectFile(p)
}
</script>
