<template>
  <div class="gmid" :style="{ flexBasis: `${width}px`, width: `${width}px` }">
    <!-- Working-tree header: title + tree/flat toggle. Stage-all / unstage-all
         now live per zone (each section header owns its verb). -->
    <div class="gchtools">
      <span class="gchtitle">{{ t('git.status.workingTree') }}</span>
      <span style="flex: 1" />
      <span class="gchseg">
        <span
          class="gsegbtn"
          :class="{ on: chTree }"
          :title="t('git.changes.tree')"
          @click="!chTree && emit('toggle-tree')"
        >
          <Icon name="folder" style="width: var(--icon-xs); height: var(--icon-xs)" />
        </span>
        <span
          class="gsegbtn"
          :class="{ on: !chTree }"
          :title="t('git.changes.flat')"
          @click="chTree && emit('toggle-tree')"
        >
          <Icon name="rules" style="width: var(--icon-xs); height: var(--icon-xs)" />
        </span>
      </span>
    </div>

    <div class="gscroll">
      <!-- Conflicted section — top of the list, above the zones. No stage action
           and no discard-all here (QĐ-2 / OQ-6): a conflicted file is resolved
           via the resolver or discarded via a global Abort, not per-file. -->
      <div v-if="conflicted.length" class="gconflictsec">
        <div class="gstatsec gconflicthd">
          <Icon name="alert" style="width: var(--icon-xs); height: var(--icon-xs)" />
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
          <span class="gsti" style="color: var(--danger)" :title="t('git.fileStatus.conflicted')">
            <Icon name="alert" />
          </span>
          <span class="gnm2">
            <span class="gp">{{ dirName(x.f) }}</span>
            <span class="gn">{{ baseName(x.f) }}</span>
          </span>
        </div>
      </div>

      <!-- Clean tree → single reassuring line instead of two empty zones. -->
      <div v-if="isClean" class="listempty">{{ t('git.changes.clean') }}</div>

      <!-- Two clearly separated zones (Unstaged on top → Staged below, mirroring
           the stage → commit flow), split by a hairline divider. Both always
           render so the destination of a staged file is always visible. -->
      <template v-else>
        <GitStatusSection
          :label="t('git.status.unstaged')"
          :files="unstaged"
          :staged="false"
          :ch-tree="chTree"
          :sel="fileSel"
          :empty-hint="t('git.changes.noUnstaged')"
          :selected-paths="selUnstaged"
          @select="(f, s, m) => emit('select', f, s, m)"
          @discard="(f) => emit('discard', f)"
          @discard-all="(files) => emit('discard-all', files)"
          @toggle-stage="(f, s) => emit('toggle-stage', f, s)"
          @stage-all="emit('stage-all')"
          @context-file="(e, f, s) => emit('context-file', e, f, s)"
          @context-folder="(e, p, s) => emit('context-folder', e, p, s)"
        />

        <div class="gzonediv" />

        <GitStatusSection
          :label="t('git.status.staged')"
          :files="staged"
          :staged="true"
          :ch-tree="chTree"
          :sel="fileSel"
          :empty-hint="t('git.changes.nothingStaged')"
          :selected-paths="selStaged"
          @select="(f, s, m) => emit('select', f, s, m)"
          @discard="(f) => emit('discard', f)"
          @discard-all="(files) => emit('discard-all', files)"
          @toggle-stage="(f, s) => emit('toggle-stage', f, s)"
          @unstage-all="emit('unstage-all')"
          @context-file="(e, f, s) => emit('context-file', e, f, s)"
          @context-folder="(e, p, s) => emit('context-folder', e, p, s)"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// Git working-tree file list (middle pane) — WORKING TREE header (stage-all /
// unstage-all / tree-flat toggle) + Staged / Changes sections (real nested tree).
// Mirrors production GitStatusList; commit panel lives in the detail pane.
import type { GitFile, GitRightPaneSel, GitSelection, SelMods } from './git-types'
import { baseNameOf, shortPath } from './git-types'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    staged: GitFile[]
    unstaged: GitFile[]
    conflicted: GitFile[]
    chTree: boolean
    sel: GitRightPaneSel
    // Multi-selection paths per zone (bulk-op highlight, never staging).
    selUnstaged: Set<string>
    selStaged: Set<string>
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

// A pristine working tree (no changes anywhere) → collapse the two empty zones
// into one clean-state line.
const isClean = computed(
  () => !props.unstaged.length && !props.staged.length && !props.conflicted.length,
)

const emit = defineEmits<{
  (e: 'toggle-tree'): void
  (e: 'select', file: string, staged: boolean, mods: SelMods): void
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
/* Conflicted header uses the danger token to signal attention. The conflict rows
   themselves reuse the shared `.gsti` status glyph (alert, danger) so the icon
   set is consistent across every zone. No hex — all via theme vars. */
.gconflicthd {
  color: var(--danger);
}
.gconflicthd .gstatlbl,
.gconflicthd .gstatct {
  color: var(--danger);
}
</style>
