<template>
  <!-- Cột giữa: bề rộng do cha kéo (inline px). -->
  <div
    class="flex flex-none flex-col overflow-hidden border-r bg-sidebar"
    :style="{ flexBasis: `${width}px`, width: `${width}px` }"
  >
    <!-- Working-tree header: title + tree/flat toggle. Stage-all / unstage-all
         now live per zone (each section header owns its verb). -->
    <div class="flex flex-none items-center border-b px-2.5 py-1.5">
      <span class="font-sans text-xs font-semibold text-muted-foreground">
        {{ t('git.status.workingTree') }}
      </span>
      <span class="flex-1" />
      <ToggleGroup
        type="single"
        class="ml-1 overflow-hidden rounded-sm border"
        :model-value="chTree ? 'tree' : 'flat'"
        @update:model-value="(v) => v && (v === 'tree') !== chTree && emit('toggle-tree')"
      >
        <ToggleGroupItem
          value="tree"
          :class="SEG"
          :title="t('git.changes.tree')"
          :aria-label="t('git.changes.tree')"
        >
          <Icon name="folder" class="size-3" />
        </ToggleGroupItem>
        <ToggleGroupItem
          value="flat"
          :class="SEG"
          :title="t('git.changes.flat')"
          :aria-label="t('git.changes.flat')"
        >
          <Icon name="rules" class="size-3" />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>

    <div class="flex-1 overflow-y-auto p-1.5">
      <!-- Conflicted section — top of the list, above the zones. No stage action
           and no discard-all here (QĐ-2 / OQ-6): a conflicted file is resolved
           via the resolver or discarded via a global Abort, not per-file. -->
      <div v-if="conflicted.length">
        <!-- Header vùng xung đột dùng màu destructive để gây chú ý. -->
        <div :class="[ZONE_HEAD, 'text-destructive']">
          <Icon name="alert" class="size-3" />
          <span :class="[ZONE_LABEL, 'text-destructive']">{{ t('git.conflict.section') }}</span>
          <span :class="[ZONE_COUNT, 'text-destructive']">{{ conflicted.length }}</span>
        </div>
        <div
          v-for="x in conflicted"
          :key="x.f"
          :class="[FILE_ROW, { [FILE_ROW_ON]: conflictSelPath === x.f }]"
          @click="emit('select-conflict', x.f)"
        >
          <span
            :class="[STATUS_LETTER, 'text-destructive']"
            :title="t('git.fileStatus.conflicted')"
          >
            !
          </span>
          <span :class="FILE_NAME">
            <!-- mono-ok: phần thư mục của path -->
            <span :class="FILE_DIR">{{ dirName(x.f) }}</span>
            <span :class="FILE_BASE">{{ baseName(x.f) }}</span>
          </span>
        </div>
      </div>

      <!-- Clean tree → single reassuring line instead of two empty zones. -->
      <div v-if="isClean" class="px-3.5 py-8 text-center text-sm text-dim">
        {{ t('git.changes.clean') }}
      </div>

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
          @discard-all="(files, folder) => emit('discard-all', files, folder)"
          @toggle-stage="(f, s) => emit('toggle-stage', f, s)"
          @stage-all="emit('stage-all')"
          @context-file="(e, f, s) => emit('context-file', e, f, s)"
          @context-folder="(e, p, s) => emit('context-folder', e, p, s)"
        />

        <Separator class="mx-1.5 my-2 w-auto" />

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
          @discard-all="(files, folder) => emit('discard-all', files, folder)"
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
import {
  FILE_BASE,
  FILE_DIR,
  FILE_NAME,
  FILE_ROW,
  FILE_ROW_ON,
  STATUS_LETTER,
  ZONE_COUNT,
  ZONE_HEAD,
  ZONE_LABEL,
} from './git-ui'
import Separator from '~/components/ui/separator/Separator.vue'
import ToggleGroup from '~/components/ui/toggle-group/ToggleGroup.vue'
import ToggleGroupItem from '~/components/ui/toggle-group/ToggleGroupItem.vue'

const { t } = useI18n()

// Nút của segmented tree/flat: đang chọn = nền secondary.
const SEG =
  'h-auto min-w-0 rounded-none px-2 py-1 text-muted-foreground hover:bg-accent data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground'

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
  (e: 'discard-all', files: string[], folder?: string): void
  (e: 'toggle-stage', file: string, staged: boolean): void
  (e: 'stage-all'): void
  (e: 'unstage-all'): void
  (e: 'context-file', event: MouseEvent, file: string, staged: boolean): void
  (e: 'context-folder', event: MouseEvent, path: string, staged: boolean): void
}>()
</script>
