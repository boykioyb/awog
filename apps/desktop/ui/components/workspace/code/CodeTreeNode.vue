<template>
  <div>
    <div
      class="group w-full flex items-center gap-1 py-0.5 transition cursor-pointer"
      :style="{
        paddingLeft: `${depth * 12 + 8}px`,
        paddingRight: '8px',
        background: isActive ? t.bgActive : 'transparent',
        color: t.text,
      }"
      @click="onClick"
      @contextmenu.prevent="onContext(entry, $event)"
    >
      <ChevronRight
        v-if="entry.kind === 'dir'"
        :size="12"
        class="flex-shrink-0 transition-transform"
        :style="{ color: t.textDim, transform: isExpanded ? 'rotate(90deg)' : 'none' }"
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
      <CodeTreeNode
        v-for="child in childrenByPath[entry.path] ?? []"
        :key="child.path"
        :entry="child"
        :depth="depth + 1"
        :expanded="expanded"
        :children-by-path="childrenByPath"
        :active-path="activePath"
        :renaming-path="renamingPath"
        :on-toggle="onToggle"
        :on-open="onOpen"
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
  activePath: string
  renamingPath: string | null
  onToggle: (path: string) => void
  onOpen: (entry: FsEntry) => void
  onContext: (entry: FsEntry, ev: MouseEvent) => void
  onRenameSubmit: (path: string, name: string) => void
  onRenameCancel: () => void
}>()

const { t } = useTheme()

const isExpanded = computed(() => props.expanded[props.entry.path] === true)
const isActive = computed(
  () => props.entry.kind === 'file' && props.activePath === props.entry.path,
)

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
  else props.onOpen(props.entry)
}

const submitRename = () => {
  const name = draft.value.trim()
  if (name && name !== props.entry.name) props.onRenameSubmit(props.entry.path, name)
  else props.onRenameCancel()
}
</script>
