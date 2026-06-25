<template>
  <span
    class="inline-flex items-center gap-1 text-[12px] leading-none px-2 py-0.5 rounded-full font-mono min-w-0 max-w-[200px]"
    :style="style"
    :title="title"
  >
    <component :is="icon" v-if="icon" :size="10" class="flex-shrink-0" />
    <span class="truncate">{{ refItem.name }}</span>
  </span>
</template>

<script setup lang="ts">
import { Archive, Cloud, GitBranch, Tag } from 'lucide-vue-next'
import type { GitRefDecoration } from '~/types'

type Props = { refItem: GitRefDecoration }
const props = defineProps<Props>()

const { t } = useTheme()

// Map each ref kind to a styled chip (prototype `.ghref` look — pill, flat):
//   HEAD          → filled accent + accentText (current branch marker)
//   branch        → outline neutral (bgElevated + border)
//   remote-branch → outline neutral, dimmer text, Cloud icon
//   tag           → amber/warning outline with Tag icon
//   stash         → muted neutral with Archive icon
const style = computed(() => {
  const tk = t.value
  switch (props.refItem.kind) {
    case 'HEAD':
      return {
        background: tk.accent,
        color: tk.accentText,
        border: `1px solid ${tk.accent}`,
        fontWeight: 600,
      }
    case 'branch':
      return {
        background: tk.bgElevated,
        color: tk.textMuted,
        border: `1px solid ${tk.border}`,
      }
    case 'remote-branch':
      return {
        background: tk.bgElevated,
        color: tk.textDim,
        border: `1px solid ${tk.border}`,
      }
    case 'tag':
      return {
        background: tk.warningBg,
        color: tk.warning,
        border: `1px solid ${tk.warningBorder}`,
      }
    case 'stash':
    default:
      return {
        background: tk.bgInput,
        color: tk.textMuted,
        border: `1px solid ${tk.border}`,
      }
  }
})

const icon = computed(() => {
  switch (props.refItem.kind) {
    case 'remote-branch':
      return Cloud
    case 'tag':
      return Tag
    case 'stash':
      return Archive
    case 'branch':
      return GitBranch
    case 'HEAD':
    default:
      return null
  }
})

const title = computed(() => {
  switch (props.refItem.kind) {
    case 'HEAD':
      return `HEAD → ${props.refItem.name}`
    case 'remote-branch':
      return `Remote branch ${props.refItem.name}`
    case 'tag':
      return `Tag ${props.refItem.name}`
    case 'stash':
      return `Stash ${props.refItem.name}`
    case 'branch':
    default:
      return `Local branch ${props.refItem.name}`
  }
})
</script>
