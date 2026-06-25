<template>
  <template v-for="(n, i) in nodes" :key="i">
    <div
      v-if="'f' in n"
      class="frow file"
      :style="isSelected(path(n.f)) ? { background: 'var(--bgActive)' } : undefined"
      @click="onFile(path(n.f))"
    >
      <span class="fst" :class="{ m: n.st === 'M', a: n.st === 'A' }">{{ n.st || '' }}</span>
      <Icon name="rules" style="width: 12px; height: 12px" />
      <span class="fn">{{ n.f }}</span>
    </div>
    <template v-else>
      <div class="frow dir" @click="onDir(path(n.d))">
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
// Shared injection key + state shape, evaluated once at module load so the
// recursive instances all reference the SAME symbol (bindings inside <script
// setup> are per-instance and would mint a fresh symbol each time).
import type { InjectionKey, Ref } from 'vue'
import type { TreeDir, TreeNode } from '~/composables/useSessionsMock'

// External controller (real-data mode): the Files tab owns expand/select state +
// lazy directory loading, and passes children for a dir via `childrenFor`. When a
// `ctrl` prop is present every instance defers to it instead of the internal
// provide/inject mock state. Keeps one recursive component for both paths (DRY).
export type FileTreeController = {
  isOpen: (path: string) => boolean
  toggle: (path: string) => void
  selectedPath: Ref<string | null>
  selectFile: (path: string) => void
  // Lazy children for a directory path (already-loaded entries, mock shape).
  childrenFor: (path: string) => TreeNode[]
}
</script>

<script setup lang="ts">
// Recursive workspace file tree (treeHtml ~1395). Self-references via global
// auto-import. Two modes:
//  • mock (no `ctrl`): dirs expand/collapse via provide/inject shared state,
//    clicking a file highlights it (original prototype behaviour).
//  • real (with `ctrl`): defers expand/select/lazy-load to the Files tab's
//    controller so a real fs tree drives the same markup.
type TreeState = { expanded: Set<string>; selected: Ref<string | null> }
const TREE_STATE = Symbol('sessionFileTreeState') as InjectionKey<TreeState>

const props = withDefaults(
  defineProps<{ nodes: TreeNode[]; prefix?: string; ctrl?: FileTreeController }>(),
  { prefix: '', ctrl: undefined },
)

// Root instance creates + provides shared mock state; nested instances inject it.
// (Only used in mock mode — `ctrl` short-circuits all of this.)
const state = inject(
  TREE_STATE,
  () => {
    const created: TreeState = { expanded: reactive(new Set<string>()), selected: ref(null) }
    provide(TREE_STATE, created)
    return created
  },
  true,
)

const path = (name: string) => (props.prefix ? `${props.prefix}/${name}` : name)

const isOpen = (p: string): boolean => (props.ctrl ? props.ctrl.isOpen(p) : !state.expanded.has(p)) // mock: default expanded
const isSelected = (p: string): boolean =>
  props.ctrl ? props.ctrl.selectedPath.value === p : state.selected.value === p

const childrenOf = (n: TreeDir): TreeNode[] =>
  props.ctrl ? props.ctrl.childrenFor(path(n.d)) : (n.ch ?? [])

function onDir(p: string): void {
  if (props.ctrl) props.ctrl.toggle(p)
  else if (state.expanded.has(p)) state.expanded.delete(p)
  else state.expanded.add(p)
}
function onFile(p: string): void {
  if (props.ctrl) props.ctrl.selectFile(p)
  else state.selected.value = p
}
</script>
