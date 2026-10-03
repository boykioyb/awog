<template>
  <template v-for="(n, i) in nodes" :key="i">
    <div
      v-if="'f' in n"
      role="button"
      tabindex="0"
      :class="[
        'flex h-7 cursor-pointer items-center gap-1.5 rounded-sm px-2 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        isSelected(path(n.f)) && 'bg-accent text-foreground',
      ]"
      @click="onFile(path(n.f))"
      @keydown.enter="onFile(path(n.f))"
      @contextmenu.prevent="ctrl.onContext?.($event, path(n.f), 'file')"
    >
      <!-- status letter — M amber / A green / D red, like the diff list -->
      <span
        class="w-3 shrink-0 text-center font-semibold"
        :class="{
          'text-warning': n.st === 'M',
          'text-success': n.st === 'A',
        }"
      >
        {{ n.st || '' }}
      </span>
      <FileCode2 class="size-3.5 shrink-0" />
      <span class="truncate text-foreground">{{ n.f }}</span>
    </div>
    <template v-else>
      <div
        role="button"
        tabindex="0"
        class="flex h-7 cursor-pointer items-center gap-1.5 rounded-sm px-2 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        @click="onDir(path(n.d))"
        @keydown.enter="onDir(path(n.d))"
        @contextmenu.prevent="ctrl.onContext?.($event, path(n.d), 'dir')"
      >
        <ChevronDown
          class="size-3 shrink-0 text-faint transition-transform"
          :class="{ '-rotate-90': !isOpen(path(n.d)) }"
        />
        <Folder class="size-3.5 shrink-0 text-muted-foreground" />
        <span class="truncate">{{ n.d }}</span>
      </div>
      <div v-if="isOpen(path(n.d))" class="ml-1.5 border-l border-border pl-2.5">
        <SessionFileTree :nodes="childrenOf(n) || []" :prefix="path(n.d)" :ctrl="ctrl" />
      </div>
    </template>
  </template>
</template>

<script lang="ts">
// Controller contract, declared in a plain <script> block so the recursive
// instances share one type import site. All imports live here — the two script
// blocks are merged into one module, so `import` statements must precede this
// block's `export` (import/first).
import type { Ref } from 'vue'
import { ChevronDown, FileCode2, Folder } from 'lucide-vue-next'
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
// (Icon imports sit in the plain <script> block above — see import/first.)
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
