<template>
  <div class="px-1 pb-1">
    <button
      class="w-full px-3 py-1.5 flex items-center gap-1.5 transition"
      :style="{
        color: t.textDim,
        background: hover ? t.bgHover : 'transparent',
      }"
      @click="collapsed = !collapsed"
      @mouseenter="hover = true"
      @mouseleave="hover = false"
    >
      <ChevronDown
        :size="10"
        :style="{
          transform: collapsed ? 'rotate(-90deg)' : 'none',
          transition: 'transform 0.15s',
        }"
      />
      <span class="text-[10px] uppercase tracking-wider font-medium flex-1 text-left truncate">
        {{ label }}
      </span>
      <span class="text-[10px]" :style="{ color: t.textFaint }">
        {{ files.length }}
      </span>
    </button>
    <template v-if="!collapsed">
      <div
        v-for="file in files"
        :key="file.path"
        class="group flex items-center gap-2 px-3 py-1.5 cursor-pointer transition"
        :style="{
          background: selectedPath === file.path ? t.bgActive : 'transparent',
        }"
        @click="emit('select', file.path)"
      >
        <input
          v-if="showStage"
          type="checkbox"
          class="cursor-pointer flex-shrink-0"
          :checked="file.isStaged"
          :style="{ accentColor: t.accent }"
          @click.stop
          @change="onToggle(file)"
        />
        <span
          class="text-[10px] font-mono w-3.5 text-center flex-shrink-0"
          :style="{ color: badgeColor(file) }"
        >
          {{ badgeChar(file) }}
        </span>
        <span
          class="text-xs truncate flex-1 font-mono"
          :style="{ color: selectedPath === file.path ? t.text : t.textMuted }"
        >
          {{ file.path }}
        </span>
        <button
          class="opacity-0 group-hover:opacity-100 transition p-1 rounded"
          title="Discard changes"
          :style="{ color: t.textDim }"
          @click.stop="emit('discard', file.path)"
        >
          <Trash2 :size="11" />
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ChevronDown, Trash2 } from 'lucide-vue-next'
import type { GitFileStatus } from '~/types'

defineProps<{
  label: string
  files: GitFileStatus[]
  selectedPath: string | null
  showStage: boolean
  isStagedSection?: boolean
}>()

const emit = defineEmits<{
  select: [path: string]
  stage: [path: string]
  unstage: [path: string]
  discard: [path: string]
}>()

const { t } = useTheme()
const collapsed = ref(false)
const hover = ref(false)

const onToggle = (file: GitFileStatus) => {
  if (file.isStaged) emit('unstage', file.path)
  else emit('stage', file.path)
}

const badgeChar = (file: GitFileStatus): string => {
  if (file.hasConflict) return 'U'
  const code = file.isStaged ? file.index : file.workTree
  switch (code) {
    case 'modified':
      return 'M'
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'copied':
      return 'C'
    case 'untracked':
      return '?'
    case 'conflicted':
      return 'U'
    default:
      return '·'
  }
}

const badgeColor = (file: GitFileStatus): string => {
  if (file.hasConflict) return t.value.gitConflict
  const code = file.isStaged ? file.index : file.workTree
  switch (code) {
    case 'added':
      return t.value.gitAdded
    case 'modified':
    case 'renamed':
    case 'copied':
      return t.value.gitModified
    case 'deleted':
      return t.value.gitDeleted
    case 'untracked':
      return t.value.gitUntracked
    default:
      return t.value.textDim
  }
}

// isStagedSection: reserved cho overload (vd. ẩn Discard ở Staged) — chưa dùng v1.
</script>
