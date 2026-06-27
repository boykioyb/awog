<template>
  <div class="gmid" :style="{ flexBasis: `${width}px`, width: `${width}px` }">
    <!-- Working-tree header: stage-all / unstage-all + tree/flat toggle -->
    <div class="gchtools">
      <span class="gchtitle">{{ t('git.status.workingTree') }}</span>
      <span style="flex: 1" />
      <span
        v-if="unstaged.length"
        class="gchbtn"
        :title="t('git.changes.stageAll')"
        @click="emit('stage-all')"
      >
        <Icon name="plus" style="width: 13px; height: 13px" />
      </span>
      <span
        v-if="staged.length"
        class="gchbtn"
        :title="t('git.changes.unstageAll')"
        @click="emit('unstage-all')"
      >
        <Icon name="rewind" style="width: 13px; height: 13px" />
      </span>
      <span class="gchseg">
        <span
          class="gsegbtn"
          :class="{ on: chTree }"
          :title="t('git.changes.tree')"
          @click="!chTree && emit('toggle-tree')"
        >
          <Icon name="folder" style="width: 12px; height: 12px" />
        </span>
        <span
          class="gsegbtn"
          :class="{ on: !chTree }"
          :title="t('git.changes.flat')"
          @click="chTree && emit('toggle-tree')"
        >
          <Icon name="rules" style="width: 12px; height: 12px" />
        </span>
      </span>
    </div>

    <div class="gscroll">
      <GitStatusSection
        v-if="staged.length"
        :label="t('git.status.staged')"
        :files="staged"
        :staged="true"
        :ch-tree="chTree"
        :sel="sel"
        @select="(f) => emit('select', f)"
        @discard="(f) => emit('discard', f)"
        @discard-all="(files) => emit('discard-all', files)"
        @toggle-stage="(f, s) => emit('toggle-stage', f, s)"
        @context-file="(e, f, s) => emit('context-file', e, f, s)"
      />

      <GitStatusSection
        :label="t('git.status.changes')"
        :files="unstaged"
        :staged="false"
        :ch-tree="chTree"
        :sel="sel"
        @select="(f) => emit('select', f)"
        @discard="(f) => emit('discard', f)"
        @discard-all="(files) => emit('discard-all', files)"
        @toggle-stage="(f, s) => emit('toggle-stage', f, s)"
        @context-file="(e, f, s) => emit('context-file', e, f, s)"
      />
      <div v-if="!unstaged.length && !staged.length" class="listempty">
        {{ t('git.changes.noUnstaged') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Git working-tree file list (middle pane) — WORKING TREE header (stage-all /
// unstage-all / tree-flat toggle) + Staged / Changes sections (real nested tree).
// Mirrors production GitStatusList; commit panel lives in the detail pane.
import type { GitFile } from './git-types'

const { t } = useI18n()

withDefaults(
  defineProps<{
    staged: GitFile[]
    unstaged: GitFile[]
    chTree: boolean
    sel: string | null
    width?: number
  }>(),
  { width: 304 },
)

const emit = defineEmits<{
  (e: 'toggle-tree'): void
  (e: 'select', file: string): void
  (e: 'discard', file: string): void
  (e: 'discard-all', files: string[]): void
  (e: 'toggle-stage', file: string, staged: boolean): void
  (e: 'stage-all'): void
  (e: 'unstage-all'): void
  (e: 'context-file', event: MouseEvent, file: string, staged: boolean): void
}>()
</script>
