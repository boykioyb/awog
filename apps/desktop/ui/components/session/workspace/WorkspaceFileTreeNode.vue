<template>
  <div>
    <div
      class="w-full flex items-center gap-1 py-0.5 transition cursor-pointer"
      :style="{
        paddingLeft: `${depth * 12 + 8}px`,
        paddingRight: '8px',
        background: rowBg,
        color: t.text,
      }"
      @click="onClick"
      @contextmenu.prevent="onContext(entry, $event)"
      @mouseenter="hovered = true"
      @mouseleave="hovered = false"
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
      <input
        v-if="renamingPath === entry.path"
        ref="renameInput"
        v-model="draft"
        class="flex-1 min-w-0 px-1 rounded text-[1em] outline-none"
        :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.borderFocus}` }"
        @click.stop
        @keydown.enter.prevent="submitRename"
        @keydown.esc.prevent="onRenameCancel"
        @blur="onRenameCancel"
      />
      <span v-else class="text-[1em] truncate">{{ entry.name }}</span>
    </div>

    <template v-if="entry.kind === 'dir' && isExpanded">
      <WorkspaceFileTreeNode
        v-for="child in childrenByPath[entry.path] ?? []"
        :key="child.path"
        :entry="child"
        :depth="depth + 1"
        :expanded="expanded"
        :children-by-path="childrenByPath"
        :selected-path="selectedPath"
        :renaming-path="renamingPath"
        :on-toggle="onToggle"
        :on-select="onSelect"
        :on-context="onContext"
        :on-rename-submit="onRenameSubmit"
        :on-rename-cancel="onRenameCancel"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ChevronRight, FileText, Folder } from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import type { FsEntry } from '~/types'

const props = defineProps<{
  entry: FsEntry
  depth: number
  expanded: Record<string, boolean>
  childrenByPath: Record<string, FsEntry[]>
  selectedPath: string | null
  renamingPath: string | null
  onToggle: (path: string) => void
  onSelect: (entry: FsEntry) => void
  onContext: (entry: FsEntry, ev: MouseEvent) => void
  onRenameSubmit: (path: string, name: string) => void
  onRenameCancel: () => void
}>()

const { t } = useTheme()

const isExpanded = computed(() => props.expanded[props.entry.path] === true)
const isSelected = computed(
  () => props.entry.kind === 'file' && props.selectedPath === props.entry.path,
)

// Selected file keeps the active tint; everything else lights up on hover.
const hovered = ref(false)
const rowBg = computed(() => {
  if (isSelected.value) return t.value.bgActive
  if (hovered.value) return t.value.bgHover
  return 'transparent'
})

const draft = ref(props.entry.name)
const renameInput = ref<HTMLInputElement | null>(null)

watch(
  () => props.renamingPath,
  async (val) => {
    if (val === props.entry.path) {
      draft.value = props.entry.name
      await nextTick()
      renameInput.value?.focus()
      renameInput.value?.select()
    }
  },
)

const onClick = () => {
  if (props.entry.kind === 'dir') props.onToggle(props.entry.path)
  else props.onSelect(props.entry)
}

const submitRename = () => {
  const name = draft.value.trim()
  if (name && name !== props.entry.name) props.onRenameSubmit(props.entry.path, name)
  else props.onRenameCancel()
}
</script>
