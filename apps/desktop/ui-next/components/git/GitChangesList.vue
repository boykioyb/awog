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
      <!-- Conflicted section — top of the list, above Staged. No stage checkbox
           and no discard-all here (QĐ-2 / OQ-6): a conflicted file is resolved
           via the resolver or discarded via a global Abort, not per-file. -->
      <div v-if="conflicted.length" class="gconflictsec">
        <div class="gstatsec gconflicthd">
          <Icon name="alert" style="width: 12px; height: 12px" />
          <span class="gstatlbl">{{ t('git.conflict.section') }}</span>
          <span class="gstatct">{{ conflicted.length }}</span>
        </div>
        <div
          v-for="x in conflicted"
          :key="x.f"
          class="gfile"
          :class="{ on: conflictSelPath === x.f }"
          @click="emit('select-conflict', x.f)"
        >
          <span class="gm gconflictbadge">U</span>
          <span class="gnm2">
            <span class="gp">{{ dirName(x.f) }}</span>
            <span class="gn">{{ baseName(x.f) }}</span>
          </span>
        </div>
      </div>

      <GitStatusSection
        v-if="staged.length"
        :label="t('git.status.staged')"
        :files="staged"
        :staged="true"
        :ch-tree="chTree"
        :sel="fileSel"
        @select="(f, s) => emit('select', f, s)"
        @discard="(f) => emit('discard', f)"
        @discard-all="(files) => emit('discard-all', files)"
        @toggle-stage="(f, s) => emit('toggle-stage', f, s)"
        @context-file="(e, f, s) => emit('context-file', e, f, s)"
        @context-folder="(e, p, s) => emit('context-folder', e, p, s)"
      />

      <GitStatusSection
        :label="t('git.status.changes')"
        :files="unstaged"
        :staged="false"
        :ch-tree="chTree"
        :sel="fileSel"
        @select="(f, s) => emit('select', f, s)"
        @discard="(f) => emit('discard', f)"
        @discard-all="(files) => emit('discard-all', files)"
        @toggle-stage="(f, s) => emit('toggle-stage', f, s)"
        @context-file="(e, f, s) => emit('context-file', e, f, s)"
        @context-folder="(e, p, s) => emit('context-folder', e, p, s)"
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
import type { GitFile, GitRightPaneSel, GitSelection } from './git-types'
import { baseNameOf, shortPath } from './git-types'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    staged: GitFile[]
    unstaged: GitFile[]
    conflicted: GitFile[]
    chTree: boolean
    sel: GitRightPaneSel
    width?: number
  }>(),
  { width: 304 },
)

// The Staged / Changes sections highlight by GitSelection; only a `file`
// selection applies to them (a `conflict` selection lives in the resolver pane).
const fileSel = computed<GitSelection | null>(() => {
  const s = props.sel
  return s?.kind === 'file' ? { path: s.path, staged: s.staged } : null
})

// Path of the currently selected conflicted file, or null. Only a `conflict`
// selection highlights a row here.
const conflictSelPath = computed<string | null>(() => {
  const s = props.sel
  return s?.kind === 'conflict' ? s.path : null
})

const baseName = (f: string) => baseNameOf(f)
const dirName = (f: string) => shortPath(f)[0]

const emit = defineEmits<{
  (e: 'toggle-tree'): void
  (e: 'select', file: string, staged: boolean): void
  (e: 'select-conflict', file: string): void
  (e: 'discard', file: string): void
  (e: 'discard-all', files: string[]): void
  (e: 'toggle-stage', file: string, staged: boolean): void
  (e: 'stage-all'): void
  (e: 'unstage-all'): void
  (e: 'context-file', event: MouseEvent, file: string, staged: boolean): void
  (e: 'context-folder', event: MouseEvent, path: string, staged: boolean): void
}>()
</script>

<style scoped>
/* Conflicted header uses the danger token to signal attention; the U badge is a
   fixed 12px mono chip (badge convention), colored del/danger, not a status
   letter. No hex — all via prototype.css vars. */
.gconflicthd {
  color: var(--danger);
}
.gconflicthd .gstatlbl,
.gconflicthd .gstatct {
  color: var(--danger);
}
.gconflictbadge {
  color: var(--del);
  font-size: 12px;
  font-family: var(--code);
  font-weight: 600;
}
</style>
