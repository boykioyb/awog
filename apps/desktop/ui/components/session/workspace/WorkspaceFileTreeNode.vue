<template>
  <div>
    <button
      type="button"
      class="w-full text-left flex items-center gap-1 py-0.5 transition"
      :style="{
        paddingLeft: `${depth * 12 + 8}px`,
        paddingRight: '8px',
        background: isSelected ? t.bgActive : 'transparent',
        color: t.text,
      }"
      @click="onClick"
    >
      <ChevronRight
        v-if="entry.kind === 'dir'"
        :size="12"
        class="flex-shrink-0 transition-transform"
        :style="{
          color: t.textDim,
          transform: isExpanded ? 'rotate(90deg)' : 'none',
        }"
      />
      <span v-else class="w-3 flex-shrink-0" />
      <component
        :is="entry.kind === 'dir' ? Folder : FileText"
        :size="13"
        class="flex-shrink-0"
        :style="{ color: t.textDim }"
      />
      <span class="text-[1em] truncate">{{ entry.name }}</span>
    </button>

    <template v-if="entry.kind === 'dir' && isExpanded">
      <WorkspaceFileTreeNode
        v-for="child in childrenByPath[entry.path] ?? []"
        :key="child.path"
        :entry="child"
        :depth="depth + 1"
        :expanded="expanded"
        :children-by-path="childrenByPath"
        :selected-path="selectedPath"
        :on-toggle="onToggle"
        :on-select="onSelect"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ChevronRight, FileText, Folder } from 'lucide-vue-next'
import { computed } from 'vue'
import type { FsEntry } from '~/types'

const props = defineProps<{
  entry: FsEntry
  depth: number
  expanded: Record<string, boolean>
  childrenByPath: Record<string, FsEntry[]>
  selectedPath: string | null
  onToggle: (path: string) => void
  onSelect: (entry: FsEntry) => void
}>()

const { t } = useTheme()

const isExpanded = computed(() => props.expanded[props.entry.path] === true)
const isSelected = computed(
  () => props.entry.kind === 'file' && props.selectedPath === props.entry.path,
)

const onClick = () => {
  if (props.entry.kind === 'dir') props.onToggle(props.entry.path)
  else props.onSelect(props.entry)
}
</script>
