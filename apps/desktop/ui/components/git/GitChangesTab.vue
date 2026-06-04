<template>
  <MasterDetailShell
    selected-id="_tab"
    list-width="20rem"
    disable-mobile
    resizable
    storage-key="awog.git.list-width.changes"
  >
    <template #list>
      <GitStatusList />
    </template>
    <template #detail>
      <div class="flex-1 overflow-hidden">
        <GitConflictResolver v-if="selectedConflictPath" :path="selectedConflictPath" />
        <GitDiffViewer
          v-else
          :diff="currentDiff"
          :can-stage-hunk="canStageSelectedHunk"
          @stage-hunk="(hunkIndex: number) => emit('stage-hunk', hunkIndex)"
        />
      </div>
      <GitCommitPanel />
    </template>
  </MasterDetailShell>
</template>

<script setup lang="ts">
import type { GitFileDiff } from '~/types'

type Props = {
  currentDiff: GitFileDiff | null
  selectedConflictPath: string | null
  canStageSelectedHunk: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  'stage-hunk': [hunkIndex: number]
}>()
</script>
