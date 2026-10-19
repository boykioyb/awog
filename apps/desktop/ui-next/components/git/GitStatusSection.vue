<template>
  <div>
    <!-- Zone header: collapse chevron + label + count + zone-wide Stage/Unstage.
         The Stage-all / Unstage-all action lives here (one per zone) so each area
         owns its verb — no ambiguous checkbox. -->
    <div :class="ZONE_HEAD" @click="zoneCollapsed = !zoneCollapsed">
      <Icon name="chev" :class="[CHEV, { '-rotate-90': zoneCollapsed }]" />
      <span :class="ZONE_LABEL">{{ label }}</span>
      <span :class="ZONE_COUNT">{{ files.length }}</span>
      <span class="flex-1" />
      <Button
        v-if="!staged && files.length"
        variant="ghost"
        size="iconSm"
        class="size-5 rounded-sm text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
        :title="t('git.status.discardAll')"
        :aria-label="t('git.status.discardAll')"
        @click.stop="discardAll"
      >
        <Icon name="revert" class="size-3" />
      </Button>
      <Button
        variant="outline"
        size="xs"
        :class="[SEC_BTN, { [SEC_BTN_STAGE]: !staged }]"
        :disabled="!files.length"
        :title="staged ? t('git.changes.unstageAll') : t('git.changes.stageAll')"
        @click.stop="staged ? emit('unstage-all') : emit('stage-all')"
      >
        <Icon :name="staged ? 'minus' : 'plus'" />
        <span>{{ staged ? t('git.changes.unstage') : t('git.changes.stage') }}</span>
      </Button>
    </div>

    <template v-if="!zoneCollapsed">
      <!-- Empty zone → hint so the area still reads as a defined place files go. -->
      <div v-if="!files.length" :class="ZONE_EMPTY">{{ emptyHint }}</div>

      <!-- Tree view: real nested folders (single-child chains collapsed) -->
      <template v-else-if="chTree">
        <template v-for="row in treeRows" :key="row.id">
          <div
            v-if="row.kind === 'dir'"
            :class="FILE_ROW"
            :style="{ paddingLeft: pad(row.depth) }"
            @click="toggleDir(row.path)"
            @contextmenu.prevent="emit('context-folder', $event, row.path, staged)"
          >
            <Icon name="chev" :class="[CHEV, { '-rotate-90': collapsedDirs.has(row.path) }]" />
            <Icon name="folder" class="size-3 flex-none" />
            <span :class="FILE_NAME">{{ row.label }}</span>
            <span v-if="!staged" class="flex flex-none items-center gap-1">
              <Button
                variant="outline"
                size="iconSm"
                :class="[ROW_ACT, ROW_ACT_DISCARD]"
                :title="t('git.ctxFolder.discard')"
                :aria-label="t('git.ctxFolder.discard')"
                @click.stop="discardFolder(row.path)"
              >
                <Icon name="revert" class="size-3" />
              </Button>
            </span>
          </div>
          <div
            v-else
            :class="[FILE_ROW, { [FILE_ROW_ON]: isOn(row.path) || isMultiSel(row.path) }]"
            :style="{ paddingLeft: pad(row.depth) }"
            @click="emit('select', row.path, staged, { meta: $event.metaKey || $event.ctrlKey })"
            @contextmenu.prevent="emit('context-file', $event, row.path, staged)"
          >
            <span :class="[STATUS_LETTER, row.v.cls]" :title="t(`git.fileStatus.${row.v.key}`)">
              {{ row.v.letter }}
            </span>
            <span :class="FILE_NAME">
              <span :class="[FILE_BASE, { 'text-foreground': isOn(row.path) }]">
                {{ row.label }}
              </span>
            </span>
            <span class="flex flex-none items-center gap-1">
              <Button
                variant="outline"
                size="iconSm"
                :class="[ROW_ACT, { [ROW_ACT_SHOWN]: isOn(row.path) }]"
                :title="staged ? t('git.changes.unstage') : t('git.changes.stage')"
                :aria-label="staged ? t('git.changes.unstage') : t('git.changes.stage')"
                @click.stop="emit('toggle-stage', row.path, staged)"
              >
                <Icon :name="staged ? 'minus' : 'plus'" class="size-3.5" />
              </Button>
              <Button
                v-if="!staged"
                variant="outline"
                size="iconSm"
                :class="[ROW_ACT, ROW_ACT_DISCARD, { [ROW_ACT_SHOWN]: isOn(row.path) }]"
                :title="t('git.changes.discard')"
                :aria-label="t('git.changes.discard')"
                @click.stop="emit('discard', row.path)"
              >
                <Icon name="revert" class="size-3" />
              </Button>
            </span>
          </div>
        </template>
      </template>

      <!-- Flat view: full path per row -->
      <template v-else>
        <div
          v-for="x in flatRows"
          :key="x.f"
          :class="[FILE_ROW, { [FILE_ROW_ON]: isOn(x.f) || isMultiSel(x.f) }]"
          @click="emit('select', x.f, staged, { meta: $event.metaKey || $event.ctrlKey })"
          @contextmenu.prevent="emit('context-file', $event, x.f, staged)"
        >
          <span :class="[STATUS_LETTER, x.v.cls]" :title="t(`git.fileStatus.${x.v.key}`)">
            {{ x.v.letter }}
          </span>
          <span :class="FILE_NAME">
            <!-- mono-ok: phần thư mục của path -->
            <span :class="FILE_DIR">{{ dirName(x.f) }}</span>
            <span :class="[FILE_BASE, { 'text-foreground': isOn(x.f) }]">{{ baseName(x.f) }}</span>
          </span>
          <span class="flex flex-none items-center gap-1">
            <Button
              variant="outline"
              size="iconSm"
              :class="[ROW_ACT, { [ROW_ACT_SHOWN]: isOn(x.f) }]"
              :title="staged ? t('git.changes.unstage') : t('git.changes.stage')"
              :aria-label="staged ? t('git.changes.unstage') : t('git.changes.stage')"
              @click.stop="emit('toggle-stage', x.f, staged)"
            >
              <Icon :name="staged ? 'minus' : 'plus'" class="size-3.5" />
            </Button>
            <Button
              v-if="!staged"
              variant="outline"
              size="iconSm"
              :class="[ROW_ACT, ROW_ACT_DISCARD, { [ROW_ACT_SHOWN]: isOn(x.f) }]"
              :title="t('git.changes.discard')"
              :aria-label="t('git.changes.discard')"
              @click.stop="emit('discard', x.f)"
            >
              <Icon name="revert" class="size-3" />
            </Button>
          </span>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
// One working-tree zone (Staged / Unstaged) — collapsible header carrying the
// zone-wide Stage/Unstage verb + a real nested folder tree (or flat full-path
// rows). Each file row shows the coloured porcelain status letter (M/A/D/R/…) and
// reveals per-file stage/unstage + discard on hover — the old stage-checkbox is
// gone (ticking-to-stage read as multi-select, which it was not).
import type { GitFile, GitSelection, PathTreeRow, SelMods, StatusVisual } from './git-types'
import { baseNameOf, buildPathTreeRows, shortPath, statusVisual } from './git-types'
import {
  CHEV,
  FILE_BASE,
  FILE_DIR,
  FILE_NAME,
  FILE_ROW,
  FILE_ROW_ON,
  ROW_ACT,
  ROW_ACT_DISCARD,
  ROW_ACT_SHOWN,
  SEC_BTN,
  SEC_BTN_STAGE,
  STATUS_LETTER,
  ZONE_COUNT,
  ZONE_EMPTY,
  ZONE_HEAD,
  ZONE_LABEL,
} from './git-ui'
import Button from '~/components/ui/button/Button.vue'

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
  (e: 'discard-all', files: string[], folder?: string): void
  (e: 'toggle-stage', file: string, staged: boolean): void
  (e: 'stage-all'): void
  (e: 'unstage-all'): void
  (e: 'context-file', event: MouseEvent, file: string, staged: boolean): void
  (e: 'context-folder', event: MouseEvent, path: string, staged: boolean): void
}>()

const { t } = useI18n()

const zoneCollapsed = ref(false)
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

// Hàng đang mở diff (selection của pane phải) trong zone này.
const isOn = (path: string) => props.sel?.path === path && props.sel?.staged === props.staged

// Accent-tint a row only for a genuine multi-selection (>1) — a lone selection is
// just the diff-focused row, so single-click looks exactly as before.
const isMultiSel = (path: string) => props.selectedPaths.size > 1 && props.selectedPaths.has(path)

function discardAll() {
  // Emit once with the full list so the parent can gate it behind a single
  // confirm — looping per-file `discard` here would pop one dialog per file.
  emit(
    'discard-all',
    props.files.map((x) => x.f),
  )
}

function discardFolder(path: string) {
  // Same single-confirm contract as discardAll — parent owns the dialog; the
  // row's revert icon collapses to "files under this dir" so the confirm text
  // names the folder rather than repeating each path.
  const prefix = `${path}/`
  emit(
    'discard-all',
    props.files.map((x) => x.f).filter((f) => f.startsWith(prefix)),
    path,
  )
}
</script>
