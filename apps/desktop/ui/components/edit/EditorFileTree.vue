<template>
  <div
    class="flex-shrink-0 flex flex-col w-full md:w-56"
    :class="{ 'hidden md:flex': hiddenOnMobile }"
    :style="{ borderRight: `1px solid ${t.border}`, background: t.bgPanel }"
  >
    <div
      class="px-3 py-2 text-[1em] uppercase tracking-wider font-medium"
      :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
    >
      Files in {{ taskId }}
    </div>
    <div class="flex-1 overflow-y-auto py-1">
      <button
        v-for="(f, i) in files"
        :key="i"
        class="w-full px-3 py-1.5 flex items-center gap-2 text-left transition"
        :style="buttonStyle(f, i)"
        @mouseenter="hoverIdx = i"
        @mouseleave="hoverIdx = -1"
        @click="emit('select-file', f.fileName)"
      >
        <GitBranch v-if="f.kind === 'diff'" :size="11" :style="{ color: t.textDim }" />
        <FileCode v-else :size="11" :style="{ color: t.textDim }" />
        <div class="flex-1 min-w-0">
          <div class="text-[1em] font-mono truncate" :style="{ color: t.text }">
            {{ f.fileName }}
          </div>
          <div class="text-[1em] truncate" :style="{ color: t.textFaint }">
            {{ f.phase }} · v{{ f.version }}
          </div>
        </div>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { FileCode, GitBranch } from 'lucide-vue-next'
import type { EditorTaskFile } from '~/types'

const props = defineProps<{
  files: EditorTaskFile[]
  taskId: string
  selectedFileName: string
  hiddenOnMobile: boolean
}>()

const emit = defineEmits<{ 'select-file': [name: string] }>()

const { t } = useTheme()
const hoverIdx = ref(-1)

const buttonStyle = (f: EditorTaskFile, i: number) => {
  const isSelected = f.fileName === props.selectedFileName
  const isHover = hoverIdx.value === i
  let background: string
  if (isSelected) background = t.value.bgActive
  else if (isHover) background = t.value.bgHover
  else background = 'transparent'
  return {
    background,
    borderLeft: `2px solid ${isSelected ? t.value.accent : 'transparent'}`,
  }
}
</script>
