<template>
  <span
    class="inline-flex items-center gap-1 text-[0.71em] px-1.5 py-0.5 rounded font-mono whitespace-nowrap"
    :style="style"
    :title="title"
  >
    <component :is="icon" v-if="icon" :size="9" />
    {{ refItem.name }}
  </span>
</template>

<script setup lang="ts">
import { Archive, Cloud, GitBranch, Tag } from 'lucide-vue-next'
import type { GitRefDecoration } from '~/types'

type Props = { refItem: GitRefDecoration }
const props = defineProps<Props>()

const { t } = useTheme()

// Map each ref kind to a styled chip:
//   HEAD          → accent fill + bold (current commit marker)
//   branch        → success/green tint (local head)
//   remote-branch → info/blue tint with Cloud icon
//   tag           → warning/yellow tint with Tag icon
//   stash         → muted gray with Archive icon
const style = computed(() => {
  const tk = t.value
  switch (props.refItem.kind) {
    case 'HEAD':
      return {
        background: tk.accent,
        color: tk.onAccent,
        border: `1px solid ${tk.accent}`,
        fontWeight: 600,
      }
    case 'branch':
      return {
        background: 'rgba(34, 197, 94, 0.12)',
        color: tk.success,
        border: `1px solid rgba(34, 197, 94, 0.35)`,
      }
    case 'remote-branch':
      return {
        background: tk.infoBg,
        color: tk.info,
        border: `1px solid ${tk.infoBorder}`,
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
