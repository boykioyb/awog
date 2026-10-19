<template>
  <div>
    <template v-for="node in nodes" :key="node.path">
      <!-- Folder: collapsible (default open). -->
      <template v-if="node.type === 'dir'">
        <Button
          variant="ghost"
          :class="ROW"
          :style="{ paddingLeft: pad }"
          @click="toggle(node.path)"
        >
          <Icon
            name="chev"
            class="size-3 flex-none text-dim transition-transform"
            :class="{ 'rotate-90': !collapsed.has(node.path) }"
          />
          <Icon name="folder" class="size-3.5 flex-none text-dim" />
          <span class="min-w-0 flex-1 truncate font-medium">{{ node.name }}</span>
        </Button>
        <ProjectGhFileTree
          v-if="!collapsed.has(node.path)"
          :nodes="node.children"
          :depth="depth + 1"
          :expanded="expanded"
          :diff-files="diffFiles"
          :diff-loading="diffLoading"
          :inline-diff="inlineDiff"
          @toggle-file="(p) => emit('toggle-file', p)"
          @context-file="(ev, p) => emit('context-file', ev, p)"
        />
      </template>

      <!-- File: click to reveal its inline diff. -->
      <template v-else>
        <Button
          variant="ghost"
          :class="[ROW, expanded === node.path && 'bg-selected hover:bg-selected']"
          :style="{ paddingLeft: filePad }"
          :title="node.path"
          @click="emit('toggle-file', node.path)"
          @contextmenu.prevent="emit('context-file', $event, node.path)"
        >
          <Icon name="file" class="size-3.5 flex-none text-dim" />
          <span class="min-w-0 flex-1 truncate">{{ node.name }}</span>
          <span class="flex flex-none gap-2 text-sm tabular-nums">
            <span v-if="node.additions" class="text-diff-add">+{{ node.additions }}</span>
            <span v-if="node.deletions" class="text-diff-del">−{{ node.deletions }}</span>
          </span>
        </Button>
        <div
          v-if="inlineDiff && expanded === node.path"
          class="mt-0.5 mb-1.5 overflow-hidden rounded-md border"
        >
          <div v-if="diffLoading" class="px-3 py-2.5 text-sm text-dim">
            {{ t('projects.drawer.diffLoading') }}
          </div>
          <ProjectGhFileDiff v-else :patch="patchFor(node.path)" />
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
// Recursive directory tree for a PR's changed files (GitHub "Files changed" style):
// collapsible folders + file rows with a diff-stat, click a file to reveal its inline
// diff. Pure presentation — `expanded` (the open file path) + the parsed patches live
// in the parent controller; toggling a file bubbles up via `toggle-file`. Folder
// collapse is local per level.
import { computed, ref } from 'vue'
import ProjectGhFileDiff from './ProjectGhFileDiff.vue'
import Button from '~/components/ui/button/Button.vue'
import type { GhTreeNode } from '~/utils/gh-file-tree'
import type { GhDiffFile } from '~/composables/useProjectGh'

defineOptions({ name: 'ProjectGhFileTree' })

const props = withDefaults(
  defineProps<{
    nodes: GhTreeNode[]
    expanded: string | null
    diffFiles: GhDiffFile[]
    diffLoading: boolean
    depth?: number
    // Render each file's diff inline under its row (docked panel). Off in the
    // fullscreen two-pane layout, where the diff shows in a dedicated right pane.
    inlineDiff?: boolean
  }>(),
  { depth: 0, inlineDiff: true },
)

const emit = defineEmits<{
  (e: 'toggle-file', path: string): void
  (e: 'context-file', ev: MouseEvent, path: string): void
}>()

const { t } = useI18n()

// Folders at this level, collapsed by path. Default expanded.
const collapsed = ref<Set<string>>(new Set())
function toggle(path: string): void {
  const next = new Set(collapsed.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  collapsed.value = next
}

const pad = computed(() => `${props.depth * 14 + 9}px`)
// Files have no chevron column → indent past the folder chevron (12px + 7px gap) so
// the file icon lines up under its folder's name.
const filePad = computed(() => `${props.depth * 14 + 9 + 19}px`)

// Hàng cây = cả dòng là một vùng bấm (Button ghost căn trái).
const ROW =
  'h-auto w-full justify-start gap-2 rounded-sm py-1 pr-2.5 text-base font-normal text-foreground'

function patchFor(path: string): string {
  return props.diffFiles.find((f) => f.path === path)?.patch ?? ''
}
</script>
