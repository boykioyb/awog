<template>
  <div>
    <!-- Zone header: collapse chevron + label + count + zone-wide Stage/Unstage.
         The Stage-all / Unstage-all action lives here (one per zone) so each area
         owns its verb — no ambiguous checkbox. -->
    <div class="gstatsec" @click="collapsed = !collapsed">
      <svg class="icn gchv" :class="{ col: collapsed }"><use href="#i-chev" /></svg>
      <span class="gstatlbl">{{ label }}</span>
      <span class="gstatct">{{ files.length }}</span>
      <span class="gstatsp" />
      <span
        v-if="!staged && files.length"
        class="gstatact"
        :title="t('git.status.discardAll')"
        @click.stop="discardAll"
      >
        <Icon name="revert" style="width: 12px; height: 12px" />
      </span>
      <button
        class="gsecbtn"
        :class="{ stage: !staged }"
        :disabled="!files.length"
        :title="staged ? t('git.changes.unstageAll') : t('git.changes.stageAll')"
        @click.stop="staged ? emit('unstage-all') : emit('stage-all')"
      >
        <Icon :name="staged ? 'minus' : 'plus'" style="width: 12px; height: 12px" />
        <span>{{ staged ? t('git.changes.unstage') : t('git.changes.stage') }}</span>
      </button>
    </div>

    <template v-if="!collapsed">
      <!-- Empty zone → hint so the area still reads as a defined place files go. -->
      <div v-if="!files.length" class="gsecempty">{{ emptyHint }}</div>

      <!-- Tree view: real nested folders (single-child chains collapsed) -->
      <template v-else-if="chTree">
        <template v-for="row in treeRows" :key="row.id">
          <div
            v-if="row.kind === 'dir'"
            class="gtdir"
            :style="{ paddingLeft: pad(row.depth) }"
            @click="toggleDir(row.path)"
            @contextmenu.prevent="emit('context-folder', $event, row.path, staged)"
          >
            <svg class="icn fchv" :class="{ col: collapsedDirs.has(row.path) }">
              <use href="#i-chev" />
            </svg>
            <Icon name="folder" style="width: 12px; height: 12px" />
            <span class="gtrunc">{{ row.label }}</span>
          </div>
          <div
            v-else
            class="gfile"
            :class="{
              on: sel?.path === row.path && sel?.staged === staged,
              msel: isMultiSel(row.path),
            }"
            :style="{ paddingLeft: pad(row.depth) }"
            @click="emit('select', row.path, staged, { meta: $event.metaKey || $event.ctrlKey })"
            @contextmenu.prevent="emit('context-file', $event, row.path, staged)"
          >
            <span
              class="gsti"
              :style="{ color: row.v.color }"
              :title="t(`git.fileStatus.${row.v.key}`)"
            >
              <Icon :name="row.v.icon" />
            </span>
            <span class="gnm2">
              <span class="gn">{{ row.label }}</span>
            </span>
            <span class="growact">
              <span
                class="gstage"
                :title="staged ? t('git.changes.unstage') : t('git.changes.stage')"
                @click.stop="emit('toggle-stage', row.path, staged)"
              >
                <Icon :name="staged ? 'minus' : 'plus'" style="width: 13px; height: 13px" />
              </span>
              <span
                v-if="!staged"
                class="gstage gdiscard"
                :title="t('git.changes.discard')"
                @click.stop="emit('discard', row.path)"
              >
                <Icon name="revert" style="width: 12px; height: 12px" />
              </span>
            </span>
          </div>
        </template>
      </template>

      <!-- Flat view: full path per row -->
      <template v-else>
        <div
          v-for="x in flatRows"
          :key="x.f"
          class="gfile"
          :class="{
            on: sel?.path === x.f && sel?.staged === staged,
            msel: isMultiSel(x.f),
          }"
          @click="emit('select', x.f, staged, { meta: $event.metaKey || $event.ctrlKey })"
          @contextmenu.prevent="emit('context-file', $event, x.f, staged)"
        >
          <span class="gsti" :style="{ color: x.v.color }" :title="t(`git.fileStatus.${x.v.key}`)">
            <Icon :name="x.v.icon" />
          </span>
          <span class="gnm2">
            <span class="gp">{{ dirName(x.f) }}</span>
            <span class="gn">{{ baseName(x.f) }}</span>
          </span>
          <span class="growact">
            <span
              class="gstage"
              :title="staged ? t('git.changes.unstage') : t('git.changes.stage')"
              @click.stop="emit('toggle-stage', x.f, staged)"
            >
              <Icon :name="staged ? 'minus' : 'plus'" style="width: 13px; height: 13px" />
            </span>
            <span
              v-if="!staged"
              class="gstage gdiscard"
              :title="t('git.changes.discard')"
              @click.stop="emit('discard', x.f)"
            >
              <Icon name="revert" style="width: 12px; height: 12px" />
            </span>
          </span>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
// One working-tree zone (Staged / Unstaged) — collapsible header carrying the
// zone-wide Stage/Unstage verb + a real nested folder tree (or flat full-path
// rows). Each file row shows a colored status glyph (no raw porcelain letter) and
// reveals per-file stage/unstage + discard on hover — the old stage-checkbox is
// gone (ticking-to-stage read as multi-select, which it was not).
import type { GitFile, GitSelection, PathTreeRow, SelMods, StatusVisual } from './git-types'
import { baseNameOf, buildPathTreeRows, shortPath, statusVisual } from './git-types'

const props = defineProps<{
  label: string
  files: GitFile[]
  staged: boolean
  chTree: boolean
  sel: GitSelection | null
  emptyHint: string
  // Paths multi-selected in this zone (pure highlight for bulk ops, never stages).
  selectedPaths: Set<string>
}>()

const emit = defineEmits<{
  (e: 'select', file: string, staged: boolean, mods: SelMods): void
  (e: 'discard', file: string): void
  (e: 'discard-all', files: string[]): void
  (e: 'toggle-stage', file: string, staged: boolean): void
  (e: 'stage-all'): void
  (e: 'unstage-all'): void
  (e: 'context-file', event: MouseEvent, file: string, staged: boolean): void
  (e: 'context-folder', event: MouseEvent, path: string, staged: boolean): void
}>()

const { t } = useI18n()

const collapsed = ref(false)
const collapsedDirs = ref<Set<string>>(new Set())

// Rows carry their pre-resolved status visual so the template resolves it once
// per row (memoised by the computed) instead of on every re-render.
type FileTreeRow = Extract<PathTreeRow, { kind: 'file' }> & { v: StatusVisual }
type TreeRow = Extract<PathTreeRow, { kind: 'dir' }> | FileTreeRow

const treeRows = computed<TreeRow[]>(() =>
  buildPathTreeRows(props.files, collapsedDirs.value).map((r) =>
    r.kind === 'file' ? { ...r, v: statusVisual(r.item.st) } : r,
  ),
)

const flatRows = computed<(GitFile & { v: StatusVisual })[]>(() =>
  props.files.map((x) => ({ ...x, v: statusVisual(x.st) })),
)

function toggleDir(path: string) {
  const next = new Set(collapsedDirs.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  collapsedDirs.value = next
}

// Indent: dirs at depth d, files at depth d+1 → files nest one step deeper.
const pad = (depth: number) => `${8 + depth * 14}px`

const baseName = (f: string) => baseNameOf(f)
const dirName = (f: string) => shortPath(f)[0]

// Accent-tint a row only for a genuine multi-selection (>1) — a lone selection is
// just the diff-focused row (`.on`), so single-click looks exactly as before.
const isMultiSel = (path: string) => props.selectedPaths.size > 1 && props.selectedPaths.has(path)

function discardAll() {
  // Emit once with the full list so the parent can gate it behind a single
  // confirm — looping per-file `discard` here would pop one dialog per file.
  emit(
    'discard-all',
    props.files.map((x) => x.f),
  )
}
</script>
