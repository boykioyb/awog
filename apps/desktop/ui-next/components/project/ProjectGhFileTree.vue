<template>
  <div class="ghtree">
    <template v-for="node in nodes" :key="node.path">
      <!-- Folder: collapsible (default open). -->
      <template v-if="node.type === 'dir'">
        <button
          type="button"
          class="ghtrow ghtdir"
          :style="{ paddingLeft: pad }"
          @click="toggle(node.path)"
        >
          <Icon
            name="chev"
            class="ghtchev"
            :class="{ open: !collapsed.has(node.path) }"
            style="width: 12px; height: 12px"
          />
          <Icon name="folder" class="ghtic" style="width: 13px; height: 13px" />
          <span class="ghtname">{{ node.name }}</span>
        </button>
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
        <button
          type="button"
          class="ghtrow ghtfile"
          :class="{ on: expanded === node.path }"
          :style="{ paddingLeft: filePad }"
          :title="node.path"
          @click="emit('toggle-file', node.path)"
          @contextmenu.prevent="emit('context-file', $event, node.path)"
        >
          <Icon name="file" class="ghtic" style="width: 13px; height: 13px" />
          <span class="ghtname">{{ node.name }}</span>
          <span class="ghtstat">
            <span v-if="node.additions" style="color: var(--add)">+{{ node.additions }}</span>
            <span v-if="node.deletions" style="color: var(--del)">−{{ node.deletions }}</span>
          </span>
        </button>
        <div v-if="inlineDiff && expanded === node.path" class="ghtdiff">
          <div v-if="diffLoading" class="fd ghtdiff-loading">
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

function patchFor(path: string): string {
  return props.diffFiles.find((f) => f.path === path)?.patch ?? ''
}
</script>

<style scoped>
.ghtrow {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 5px 10px 5px 9px;
  border: 0;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  font-size: 1em;
  border-radius: var(--r-xs);
}
.ghtrow:hover {
  background: var(--bgHover);
}
.ghtfile.on {
  background: var(--bgActive);
}
.ghtchev {
  flex: 0 0 auto;
  color: var(--textDim);
  transition: transform 0.12s ease;
}
.ghtchev.open {
  transform: rotate(90deg);
}
.ghtic {
  flex: 0 0 auto;
  color: var(--textDim);
}
.ghtdir .ghtname {
  font-weight: 550;
}
.ghtname {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ghtstat {
  flex: 0 0 auto;
  display: flex;
  gap: 7px;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  line-height: 18px;
}
.ghtdiff {
  margin: 2px 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  overflow: hidden;
}
.ghtdiff-loading {
  padding: 10px 12px;
}
</style>
