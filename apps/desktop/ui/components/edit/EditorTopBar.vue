<template>
  <div
    class="min-h-10 flex flex-wrap items-center px-3 gap-2 py-1 flex-shrink-0"
    :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
  >
    <button
      class="flex items-center gap-1.5 px-2 py-1 text-[1em] rounded transition"
      :style="{
        color: backHover ? t.text : t.textMuted,
        background: backHover ? t.bgHover : 'transparent',
      }"
      @mouseenter="backHover = true"
      @mouseleave="backHover = false"
      @click="emit('back')"
    >
      <ArrowLeft :size="12" />
      Back to task
    </button>
    <div class="w-px h-4" :style="{ background: t.border }" />
    <GitBranch v-if="fileKind === 'diff'" :size="12" :style="{ color: t.textDim }" />
    <FileCode v-else :size="12" :style="{ color: t.textDim }" />
    <span class="text-[1em] font-mono" :style="{ color: t.text }">{{ fileName }}</span>
    <span class="text-[1em]" :style="{ color: t.textFaint }">· {{ taskId }}</span>

    <div v-if="diffStats" class="flex items-center gap-2 ml-2 text-[1em] font-mono">
      <span :style="{ color: t.textDim }">
        {{ diffStats.files }} {{ diffStats.files === 1 ? 'file' : 'files' }}
      </span>
      <span :style="{ color: t.diffAdd }">+{{ diffStats.additions }}</span>
      <span :style="{ color: t.diffDel }">−{{ diffStats.deletions }}</span>
    </div>

    <div class="ml-auto flex items-center gap-1">
      <div
        v-if="fileKind !== 'diff'"
        class="flex rounded overflow-hidden"
        :style="{ border: `1px solid ${t.border}` }"
      >
        <button
          v-for="v in viewOptions"
          :key="v.id"
          class="px-2 py-1 text-[1em] flex items-center gap-1 transition"
          :style="{
            background: activeView === v.id ? t.bgActive : 'transparent',
            color: activeView === v.id ? t.text : t.textDim,
          }"
          @click="emit('change-view', v.id)"
        >
          <component :is="v.icon" :size="11" />
          {{ v.label }}
        </button>
      </div>
      <button
        class="p-1.5 rounded transition"
        :style="{
          color: copyHover ? t.text : t.textDim,
          background: copyHover ? t.bgHover : 'transparent',
        }"
        title="Copy"
        @mouseenter="copyHover = true"
        @mouseleave="copyHover = false"
        @click="emit('copy')"
      >
        <Copy :size="12" />
      </button>
      <button
        class="p-1.5 rounded transition"
        :style="{
          color: dlHover ? t.text : t.textDim,
          background: dlHover ? t.bgHover : 'transparent',
        }"
        title="Download"
        @mouseenter="dlHover = true"
        @mouseleave="dlHover = false"
        @click="emit('download')"
      >
        <Download :size="12" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowLeft,
  Code2,
  Copy,
  Download,
  Eye,
  FileCode,
  GitBranch,
  PanelLeftOpen,
} from 'lucide-vue-next'
import type { EditorViewMode, EditorFileKind, EditorDiffStats } from '~/types'

defineProps<{
  fileName: string
  taskId: string
  fileKind: EditorFileKind
  activeView: EditorViewMode
  diffStats: EditorDiffStats | null
}>()

const emit = defineEmits<{
  back: []
  'change-view': [view: EditorViewMode]
  copy: []
  download: []
}>()

const { t } = useTheme()

const backHover = ref(false)
const copyHover = ref(false)
const dlHover = ref(false)

const viewOptions = [
  { id: 'code' as const, label: 'Code', icon: Code2 },
  { id: 'split' as const, label: 'Split', icon: PanelLeftOpen },
  { id: 'preview' as const, label: 'Preview', icon: Eye },
]
</script>
