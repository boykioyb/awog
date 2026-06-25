<template>
  <div class="px-1 pb-1">
    <div
      class="group flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <button
        class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        @click="collapsed = !collapsed"
      >
        <ChevronDown
          :size="10"
          :style="{
            transform: collapsed ? 'rotate(-90deg)' : 'none',
            transition: 'transform 0.15s',
          }"
        />
        <span class="truncate text-[1em] font-medium uppercase tracking-wider">
          {{ label }}
        </span>
      </button>
      <span class="flex-shrink-0 font-mono text-[12px] leading-none text-muted-foreground">
        {{ files.length }}
      </span>
      <button
        v-if="!isStagedSection && files.length > 0"
        class="flex-shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
        :title="tr('git.status.discard_all')"
        @click.stop="emit('discard-all', allPaths, label)"
      >
        <Trash2 :size="11" />
      </button>
    </div>
    <template v-if="!collapsed">
      <!-- Tree view: folder-grouped (collapse single-child dir chains). -->
      <template v-if="viewMode === 'tree'">
        <template v-for="row in treeRows" :key="row.id">
          <div
            v-if="row.kind === 'dir'"
            class="group/dir w-full flex items-center gap-1 px-3 py-1.5 transition"
            :style="{
              paddingLeft: `${12 + row.depth * 12}px`,
              color: t.textMuted,
            }"
          >
            <input
              v-if="showStage"
              type="checkbox"
              class="cursor-pointer flex-shrink-0"
              :checked="dirStageState(row.path) === 'all'"
              :indeterminate="dirStageState(row.path) === 'some'"
              :style="{ accentColor: t.accent }"
              @click.stop
              @change="onToggleDirStage(row.path)"
            />
            <button
              class="flex items-center gap-1 flex-1 min-w-0 text-left"
              @click="toggleDir(row.path)"
            >
              <ChevronDown
                v-if="!collapsedDirs.has(row.path)"
                :size="10"
                :style="{ color: t.textFaint, flexShrink: 0 }"
              />
              <ChevronRight v-else :size="10" :style="{ color: t.textFaint, flexShrink: 0 }" />
              <Folder :size="12" :style="{ color: t.textDim, flexShrink: 0 }" />
              <span class="text-[1em] truncate font-mono">{{ row.label }}</span>
            </button>
            <button
              v-if="!isStagedSection"
              class="opacity-0 group-hover/dir:opacity-100 transition p-1 rounded flex-shrink-0"
              :title="tr('git.menu.discard_folder')"
              :style="{ color: t.textDim }"
              @click.stop="emit('discard-folder', descendantPaths(row.path), row.label)"
            >
              <Trash2 :size="11" />
            </button>
          </div>
          <div
            v-else
            class="group flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 transition-colors"
            :class="
              selectedPath === row.item.path
                ? 'bg-accent text-accent-foreground'
                : 'text-foreground hover:bg-accent hover:text-accent-foreground'
            "
            :style="{ paddingLeft: `${12 + row.depth * 12}px` }"
            @click="emit('select', row.item.path)"
            @contextmenu.prevent="emit('context-menu', $event, row.item)"
          >
            <input
              v-if="showStage"
              type="checkbox"
              class="cursor-pointer flex-shrink-0"
              :checked="row.item.isStaged"
              :style="{ accentColor: t.accent }"
              @click.stop
              @change="onToggle(row.item)"
            />
            <span
              class="text-[12px] leading-none font-mono font-bold w-3.5 text-center flex-shrink-0"
              :style="{ color: badgeColor(row.item) }"
            >
              {{ badgeChar(row.item) }}
            </span>
            <span class="text-[1em] truncate flex-1 font-mono" :style="{ color: t.text }">
              {{ row.label }}
            </span>
            <button
              class="opacity-0 group-hover:opacity-100 transition p-1 rounded"
              title="Discard changes"
              :style="{ color: t.textDim }"
              @click.stop="emit('discard', row.item.path)"
            >
              <Trash2 :size="11" />
            </button>
          </div>
        </template>
      </template>

      <!-- Flat view — naive render when small, virtualize when > VIRTUAL_THRESHOLD (AC-44). -->
      <template v-else-if="files.length <= VIRTUAL_THRESHOLD">
        <div
          v-for="file in files"
          :key="file.path"
          class="group flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 transition-colors"
          :class="
            selectedPath === file.path
              ? 'bg-accent text-accent-foreground'
              : 'text-foreground hover:bg-accent hover:text-accent-foreground'
          "
          @click="emit('select', file.path)"
          @contextmenu.prevent="emit('context-menu', $event, file)"
        >
          <input
            v-if="showStage"
            type="checkbox"
            class="cursor-pointer flex-shrink-0"
            :checked="file.isStaged"
            :style="{ accentColor: t.accent }"
            @click.stop
            @change="onToggle(file)"
          />
          <span
            class="text-[12px] leading-none font-mono font-bold w-3.5 text-center flex-shrink-0"
            :style="{ color: badgeColor(file) }"
          >
            {{ badgeChar(file) }}
          </span>
          <span class="text-[1em] truncate flex-1 font-mono" :style="{ color: t.text }">
            {{ file.path }}
          </span>
          <button
            class="opacity-0 group-hover:opacity-100 transition p-1 rounded"
            title="Discard changes"
            :style="{ color: t.textDim }"
            @click.stop="emit('discard', file.path)"
          >
            <Trash2 :size="11" />
          </button>
        </div>
      </template>
      <div
        v-else
        ref="virtualContainer"
        class="overflow-auto"
        :style="{ maxHeight: `${VIRTUAL_MAX_HEIGHT}px` }"
        @scroll="onScroll"
      >
        <div :style="{ height: `${files.length * ROW_HEIGHT}px`, position: 'relative' }">
          <div
            :style="{
              position: 'absolute',
              top: `${startIndex * ROW_HEIGHT}px`,
              left: 0,
              right: 0,
            }"
          >
            <div
              v-for="i in visibleRange"
              :key="files[i]?.path ?? i"
              class="group flex cursor-pointer items-center gap-2 px-3 transition-colors"
              :class="
                selectedPath === files[i]?.path
                  ? 'bg-accent text-accent-foreground'
                  : 'text-foreground hover:bg-accent hover:text-accent-foreground'
              "
              :style="{ height: `${ROW_HEIGHT}px` }"
              @click="files[i] && emit('select', files[i]!.path)"
              @contextmenu.prevent="files[i] && emit('context-menu', $event, files[i]!)"
            >
              <input
                v-if="showStage && files[i]"
                type="checkbox"
                class="cursor-pointer flex-shrink-0"
                :checked="files[i]!.isStaged"
                :style="{ accentColor: t.accent }"
                @click.stop
                @change="files[i] && onToggle(files[i]!)"
              />
              <span
                v-if="files[i]"
                class="text-[12px] leading-none font-mono font-bold w-3.5 text-center flex-shrink-0"
                :style="{ color: badgeColor(files[i]!) }"
              >
                {{ badgeChar(files[i]!) }}
              </span>
              <span
                v-if="files[i]"
                class="text-[1em] truncate flex-1 font-mono"
                :style="{ color: t.text }"
              >
                {{ files[i]!.path }}
              </span>
              <button
                v-if="files[i]"
                class="opacity-0 group-hover:opacity-100 transition p-1 rounded"
                title="Discard changes"
                :style="{ color: t.textDim }"
                @click.stop="emit('discard', files[i]!.path)"
              >
                <Trash2 :size="11" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ChevronDown, ChevronRight, Folder, Trash2 } from 'lucide-vue-next'
import type { GitFileStatus } from '~/types'
import { buildPathTreeRows } from '~/utils/file-path-tree'

const props = withDefaults(
  defineProps<{
    label: string
    files: GitFileStatus[]
    selectedPath: string | null
    showStage: boolean
    isStagedSection?: boolean
    viewMode?: 'tree' | 'flat'
  }>(),
  { isStagedSection: false, viewMode: 'flat' },
)

const emit = defineEmits<{
  select: [path: string]
  stage: [path: string]
  unstage: [path: string]
  discard: [path: string]
  'discard-all': [paths: string[], target: string]
  'discard-folder': [paths: string[], target: string]
  'stage-folder': [paths: string[]]
  'unstage-folder': [paths: string[]]
  'context-menu': [event: MouseEvent, file: GitFileStatus]
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const collapsed = ref(false)

// Paths owned by this whole section (used by the header "discard all" button).
const allPaths = computed(() => props.files.map((f) => f.path))

// Files under a tree directory row — `dirPath` is the merged full path of the
// (possibly collapsed) dir chain, so descendants match the `dirPath/` prefix.
const dirDescendants = (dirPath: string): GitFileStatus[] =>
  props.files.filter((f) => f.path.startsWith(`${dirPath}/`))
const descendantPaths = (dirPath: string): string[] => dirDescendants(dirPath).map((f) => f.path)

// Tri-state of a folder's stage checkbox from its descendant files.
const dirStageState = (dirPath: string): 'all' | 'some' | 'none' => {
  const kids = dirDescendants(dirPath)
  const staged = kids.filter((f) => f.isStaged).length
  if (staged === 0) return 'none'
  return staged === kids.length ? 'all' : 'some'
}

const onToggleDirStage = (dirPath: string) => {
  const paths = descendantPaths(dirPath)
  if (dirStageState(dirPath) === 'all') emit('unstage-folder', paths)
  else emit('stage-folder', paths)
}

// ─── Tree view ─────────────────────────────────────────────────────────────
// Dirs expanded by default (you want to see what changed); collapse on click.
const collapsedDirs = ref<Set<string>>(new Set())
const treeRows = computed(() => buildPathTreeRows(props.files, collapsedDirs.value))
const toggleDir = (path: string) => {
  const next = new Set(collapsedDirs.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  collapsedDirs.value = next
}

// Virtual scroll (AC-44). Switch on when section has > VIRTUAL_THRESHOLD files
// — naive `v-for` handles small lists faster without DOM overhead.
const VIRTUAL_THRESHOLD = 200
const ROW_HEIGHT = 28 // px — keep in sync with row inline height style
const VIRTUAL_MAX_HEIGHT = 480 // px — section caps; outer scroll still handles overflow
const BUFFER = 10

const virtualContainer = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const containerHeight = ref(VIRTUAL_MAX_HEIGHT)

const onScroll = (e: Event) => {
  const el = e.target as HTMLElement
  scrollTop.value = el.scrollTop
  containerHeight.value = el.clientHeight
}

const startIndex = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - BUFFER))
const endIndex = computed(() =>
  Math.min(
    props.files.length,
    Math.ceil((scrollTop.value + containerHeight.value) / ROW_HEIGHT) + BUFFER,
  ),
)
const visibleRange = computed(() => {
  const range: number[] = []
  for (let i = startIndex.value; i < endIndex.value; i += 1) range.push(i)
  return range
})

const onToggle = (file: GitFileStatus) => {
  if (file.isStaged) emit('unstage', file.path)
  else emit('stage', file.path)
}

const badgeChar = (file: GitFileStatus): string => {
  if (file.hasConflict) return 'U'
  const code = file.isStaged ? file.index : file.workTree
  switch (code) {
    case 'modified':
      return 'M'
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'copied':
      return 'C'
    case 'untracked':
      return '?'
    case 'conflicted':
      return 'U'
    default:
      return '·'
  }
}

const badgeColor = (file: GitFileStatus): string => {
  if (file.hasConflict) return t.value.gitConflict
  const code = file.isStaged ? file.index : file.workTree
  switch (code) {
    case 'added':
      return t.value.gitAdded
    case 'modified':
    case 'renamed':
    case 'copied':
      return t.value.gitModified
    case 'deleted':
      return t.value.gitDeleted
    case 'untracked':
      return t.value.gitUntracked
    default:
      return t.value.textDim
  }
}

// isStagedSection: reserved cho overload (vd. ẩn Discard ở Staged) — chưa dùng v1.
</script>
