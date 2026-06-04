<template>
  <div class="mb-1">
    <div class="px-3 py-1 text-[12px] uppercase tracking-wide" :style="{ color: t.textDim }">
      {{ label }}
      <span class="font-mono" :style="{ color: t.textFaint }">({{ files.length }})</span>
    </div>
    <div
      v-for="file in files"
      :key="file.path"
      class="group flex items-center gap-2 px-3 py-0.5 transition cursor-pointer"
      :style="{ color: t.text }"
      @click="emit('open', file.path)"
      @mouseenter="(e) => bg(e, t.bgHover)"
      @mouseleave="(e) => bg(e, 'transparent')"
    >
      <span class="text-[1em] truncate flex-1 font-mono">{{ baseName(file.path) }}</span>
      <button
        type="button"
        class="opacity-0 group-hover:opacity-100 transition text-[12px] px-1 rounded"
        :style="{ color: t.textDim }"
        :title="action === 'stage' ? 'Stage' : 'Unstage'"
        @click.stop="emit('action', file.path)"
      >
        {{ action === 'stage' ? '+' : '−' }}
      </button>
      <span
        class="text-[12px] font-mono font-bold w-3 text-center flex-shrink-0"
        :style="{ color: badge(file).color }"
        :title="file.changeType"
      >
        {{ badge(file).letter }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SidecarGitFileStatus } from '~/composables/useGitApi'

defineProps<{
  label: string
  files: SidecarGitFileStatus[]
  action: 'stage' | 'unstage'
}>()

const emit = defineEmits<{
  open: [path: string]
  action: [path: string]
}>()

const { t } = useTheme()

const baseName = (p: string): string => {
  const i = p.lastIndexOf('/')
  return i === -1 ? p : p.slice(i + 1)
}

const badge = (file: SidecarGitFileStatus): { letter: string; color: string } => {
  const map: Record<string, { letter: string; color: string }> = {
    added: { letter: 'A', color: t.value.gitAdded },
    modified: { letter: 'M', color: t.value.gitModified },
    deleted: { letter: 'D', color: t.value.gitDeleted },
    untracked: { letter: 'U', color: t.value.gitUntracked },
    renamed: { letter: 'R', color: t.value.gitModified },
    copied: { letter: 'C', color: t.value.gitModified },
  }
  return (
    map[file.changeType] ?? {
      letter: file.changeType.charAt(0).toUpperCase(),
      color: t.value.textDim,
    }
  )
}

const bg = (e: MouseEvent, color: string) => {
  ;(e.currentTarget as HTMLElement).style.background = color
}
</script>
