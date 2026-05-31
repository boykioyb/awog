<template>
  <div
    class="flex items-center px-3 gap-1 flex-shrink-0"
    :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
  >
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="relative flex items-center gap-1.5 px-3 py-2 text-[1em] transition"
      :style="tabStyle(tab.id)"
      @click="emit('update:active-tab', tab.id)"
    >
      <component :is="tab.icon" :size="11" />
      <span>{{ tab.label }}</span>
      <span
        v-if="tab.id === 'changes' && hasUncommitted"
        class="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
        :style="{ background: hasConflict ? t.gitConflict : t.warning }"
      />
    </button>
  </div>
</template>

<script setup lang="ts">
import {
  Archive,
  Cloud,
  GitBranch as GitBranchIcon,
  GitCommit as GitCommitIcon,
  History,
} from 'lucide-vue-next'
import type { GitTab } from './git-tabs'

type Props = {
  activeTab: GitTab
  hasUncommitted: boolean
  hasConflict: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:active-tab': [tab: GitTab]
}>()

const { t } = useTheme()

const tabs = [
  { id: 'changes' as const, label: 'Changes', icon: GitCommitIcon },
  { id: 'history' as const, label: 'History', icon: History },
  { id: 'branches' as const, label: 'Branches', icon: GitBranchIcon },
  { id: 'stash' as const, label: 'Stash', icon: Archive },
  { id: 'remotes' as const, label: 'Remotes', icon: Cloud },
]

const tabStyle = (id: GitTab) => {
  const active = props.activeTab === id
  return {
    background: 'transparent',
    color: active ? t.value.text : t.value.textDim,
    borderBottom: `2px solid ${active ? t.value.accent : 'transparent'}`,
    marginBottom: '-1px',
  }
}
</script>
