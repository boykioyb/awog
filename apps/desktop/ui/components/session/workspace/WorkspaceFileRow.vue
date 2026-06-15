<template>
  <div
    class="w-full flex items-center gap-2 py-1 px-3 transition cursor-pointer"
    :style="{ background: rowBg, color: t.text }"
    @click="onOpen(entry)"
    @contextmenu.prevent="onContext(entry, $event)"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <component
      :is="entry.kind === 'dir' ? Folder : FileText"
      :size="14"
      class="flex-shrink-0"
      :style="{ color: entry.kind === 'dir' ? t.accent : t.textDim }"
    />
    <input
      v-if="renaming"
      ref="renameInput"
      v-model="draft"
      class="flex-1 min-w-0 px-1 rounded text-[1em] outline-none"
      :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.borderFocus}` }"
      @click.stop
      @keydown.enter.prevent="submitRename"
      @keydown.esc.prevent="onRenameCancel"
      @blur="onRenameCancel"
    />
    <span v-else class="flex-1 min-w-0 text-[1em] truncate">{{ entry.name }}</span>
    <ChevronRight
      v-if="entry.kind === 'dir' && !renaming"
      :size="13"
      class="flex-shrink-0"
      :style="{ color: t.textFaint }"
    />
  </div>
</template>

<script setup lang="ts">
import { ChevronRight, FileText, Folder } from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import type { FsEntry } from '~/types'

const props = defineProps<{
  entry: FsEntry
  selected: boolean
  renaming: boolean
  onOpen: (entry: FsEntry) => void
  onContext: (entry: FsEntry, ev: MouseEvent) => void
  onRenameSubmit: (path: string, name: string) => void
  onRenameCancel: () => void
}>()

const { t } = useTheme()

// Selected file keeps the active tint; everything else lights up on hover.
const hovered = ref(false)
const rowBg = computed(() => {
  if (props.selected) return t.value.bgActive
  if (hovered.value) return t.value.bgHover
  return 'transparent'
})

const draft = ref(props.entry.name)
const renameInput = ref<HTMLInputElement | null>(null)
watch(
  () => props.renaming,
  async (val) => {
    if (val) {
      draft.value = props.entry.name
      await nextTick()
      renameInput.value?.focus()
      renameInput.value?.select()
    }
  },
)

const submitRename = () => {
  const name = draft.value.trim()
  if (name && name !== props.entry.name) props.onRenameSubmit(props.entry.path, name)
  else props.onRenameCancel()
}
</script>
