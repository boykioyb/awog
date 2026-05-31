<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div
      v-if="!detail"
      class="flex-1 flex items-center justify-center text-[1em]"
      :style="{ color: t.textDim }"
    >
      Select a commit
    </div>
    <template v-else>
      <!-- Tab strip -->
      <div
        class="flex items-center gap-1 px-2 py-1.5 flex-shrink-0"
        :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
      >
        <button
          v-for="tab in TABS"
          :key="tab.id"
          type="button"
          class="px-3 py-1 text-[1em] uppercase tracking-wider rounded transition"
          :style="{
            background: activeTab === tab.id ? t.bgActive : 'transparent',
            color: activeTab === tab.id ? t.text : t.textDim,
            border: `1px solid ${activeTab === tab.id ? t.border : 'transparent'}`,
          }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
        <span class="flex-1" />
        <span class="text-[1em] font-mono" :style="{ color: t.accent }">
          {{ detail.commit.shortHash }}
        </span>
      </div>

      <!-- Commit tab -->
      <div v-if="activeTab === 'commit'" class="flex-1 overflow-y-auto p-4 space-y-3">
        <!-- Author card -->
        <div
          class="rounded px-3 py-2"
          :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
        >
          <div class="text-[1em] uppercase tracking-wider mb-1" :style="{ color: t.textFaint }">
            Author
          </div>
          <div class="flex items-center gap-2">
            <span
              class="inline-flex items-center justify-center text-[1em] rounded-full"
              :style="{
                width: '24px',
                height: '24px',
                background: t.bgPanel,
                color: t.textMuted,
                border: `1px solid ${t.border}`,
              }"
            >
              {{ initials(detail.commit.authorName) }}
            </span>
            <div class="flex-1 min-w-0">
              <div class="text-[1em] truncate" :style="{ color: t.text }">
                {{ detail.commit.authorName }}
              </div>
              <div class="text-[1em] truncate" :style="{ color: t.textDim }">
                {{ detail.commit.authorEmail }}
              </div>
            </div>
            <div class="text-[1em] text-right" :style="{ color: t.textDim }">
              {{ formatDateTime(detail.commit.date) }}
            </div>
          </div>
        </div>

        <!-- SHA + parents -->
        <div class="flex flex-wrap items-center gap-2 text-[1em]">
          <span :style="{ color: t.textFaint }">SHA</span>
          <button
            type="button"
            class="font-mono px-2 py-0.5 rounded transition"
            :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.border}` }"
            title="Click to copy full SHA"
            @click="onCopyHash(detail.commit.hash)"
          >
            {{ detail.commit.hash }}
          </button>
        </div>
        <div v-if="detail.commit.parents.length > 0" class="flex flex-wrap items-center gap-2">
          <span class="text-[1em]" :style="{ color: t.textFaint }">
            Parent{{ detail.commit.parents.length > 1 ? 's' : '' }}
          </span>
          <button
            v-for="p in detail.commit.parents"
            :key="p"
            type="button"
            class="font-mono text-[1em] px-2 py-0.5 rounded transition"
            :style="{ background: t.bgInput, color: t.accent, border: `1px solid ${t.border}` }"
            @click="emit('select-parent', p)"
          >
            {{ p.slice(0, 7) }}
          </button>
        </div>

        <!-- Message -->
        <div>
          <div class="text-[1em] font-medium" :style="{ color: t.text }">
            {{ detail.commit.subject }}
          </div>
          <div
            v-if="detail.commit.body"
            class="text-[1em] mt-2 whitespace-pre-wrap"
            :style="{ color: t.textMuted }"
          >
            {{ detail.commit.body }}
          </div>
        </div>
      </div>

      <!-- Changes tab — Sublime-Merge-style layout -->
      <div v-else-if="activeTab === 'changes'" class="flex flex-col flex-1 overflow-hidden">
        <!-- Commit header strip -->
        <div
          class="flex items-center gap-2 px-3 py-1.5 flex-shrink-0"
          :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
        >
          <span
            class="inline-flex items-center justify-center text-[1em] rounded-full flex-shrink-0 font-medium"
            :style="{
              width: '22px',
              height: '22px',
              background: t.accent,
              color: t.accentText,
            }"
          >
            {{ initials(detail.commit.authorName) }}
          </span>
          <span class="text-[1em] truncate flex-shrink-0 max-w-[10rem]" :style="{ color: t.text }">
            {{ detail.commit.authorName }}
          </span>
          <button
            type="button"
            class="text-[1em] font-mono px-1.5 py-0.5 rounded transition flex-shrink-0"
            :style="{ background: t.bgInput, color: t.accent, border: `1px solid ${t.border}` }"
            title="Copy short hash"
            @click="onCopyHash(detail.commit.shortHash)"
          >
            {{ detail.commit.shortHash }}
          </button>
          <span class="text-[1em] flex-shrink-0" :style="{ color: t.textDim }">
            {{ relativeDate(detail.commit.date) }}
          </span>
          <span class="text-[1em] truncate flex-1 min-w-0" :style="{ color: t.textMuted }">
            {{ detail.commit.subject }}
          </span>
          <button
            type="button"
            class="p-1 rounded transition flex-shrink-0"
            :style="{ color: t.textDim }"
            title="Copy full SHA"
            @click="onCopyHash(detail.commit.hash)"
          >
            <Copy :size="11" />
          </button>
        </div>

        <div
          v-if="detail.files.length === 0"
          class="flex-1 flex items-center justify-center text-[1em]"
          :style="{ color: t.textDim }"
        >
          No file changes
        </div>
        <!-- 2-pane body: tree (left) + diff viewer (right) -->
        <div v-else class="flex flex-1 overflow-hidden">
          <div
            class="flex-shrink-0 overflow-hidden"
            :style="{ width: `${treeWidth}px`, borderRight: `1px solid ${t.border}` }"
          >
            <GitCommitFileTree
              :detail="detail"
              :active-file-index="activeFileIndex"
              @select-file="onSelectFile"
            />
          </div>
          <!-- Drag resizer -->
          <div
            class="flex-shrink-0 cursor-col-resize"
            :class="{ 'is-dragging': dragging }"
            :style="{
              width: '4px',
              background: dragging ? t.accent : 'transparent',
              marginLeft: '-2px',
              marginRight: '-2px',
              zIndex: 5,
            }"
            @mousedown="onDragStart"
            @dblclick="resetTreeWidth"
          />
          <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
            <!-- Diff toolbar -->
            <div
              v-if="activeFile"
              class="flex items-center gap-2 px-3 py-1.5 flex-shrink-0"
              :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
            >
              <span
                class="text-[1em] font-mono truncate flex-1 min-w-0"
                :style="{ color: t.textMuted }"
                :title="activeFile.path"
              >
                {{ activeFile.path }}
              </span>
              <button
                type="button"
                class="p-1 rounded transition flex-shrink-0"
                :style="{ color: t.textDim }"
                title="Copy path"
                @click="onCopyHash(activeFile.path)"
              >
                <Copy :size="11" />
              </button>
            </div>
            <div class="flex-1 overflow-hidden">
              <GitDiffViewer :diff="activeFile" />
            </div>
          </div>
        </div>
      </div>

      <!-- File Tree tab -->
      <div v-else class="flex flex-col flex-1 overflow-hidden">
        <div
          v-if="detail.files.length === 0"
          class="flex-1 flex items-center justify-center text-[1em]"
          :style="{ color: t.textDim }"
        >
          No files in this commit
        </div>
        <div v-else class="flex-1 overflow-y-auto py-1">
          <!-- v1 fallback: flat list-by-path. A real nested tree component can
               replace this once the rest of History UX settles. -->
          <button
            v-for="(f, i) in detail.files"
            :key="f.path"
            type="button"
            class="w-full flex items-center gap-2 px-3 py-1 text-left text-[1em] font-mono transition"
            :style="{
              background: activeFileIndex === i ? t.bgActive : 'transparent',
              color: t.text,
            }"
            @click="onSelectTreeFile(i, f.path)"
          >
            <span
              class="inline-flex items-center justify-center w-4 h-4 text-[1em] rounded"
              :style="fileStatusStyle(f)"
              :title="fileStatusLabel(f)"
            >
              {{ fileStatusLetter(f) }}
            </span>
            <span class="truncate" :style="{ color: t.textMuted }">{{ f.path }}</span>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Copy } from 'lucide-vue-next'
import type { GitCommit, GitFileDiff } from '~/types'

type Props = {
  detail: { commit: GitCommit; files: GitFileDiff[] } | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'select-parent': [hash: string]
  'select-file': [path: string]
}>()

const { t } = useTheme()

type TabId = 'commit' | 'changes' | 'tree'
const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'commit', label: 'Commit' },
  { id: 'changes', label: 'Changes' },
  { id: 'tree', label: 'File Tree' },
]
const activeTab = ref<TabId>('commit')
const activeFileIndex = ref(0)

const activeFile = computed<GitFileDiff | null>(
  () => props.detail?.files[activeFileIndex.value] ?? null,
)

// Heuristic A/M/D/R classifier — sidecar's `GitFileDiff` doesn't carry an
// explicit status field for commits, so we infer from the parse result.
// File Tree shows the marker for at-a-glance UX; if the marker is wrong the
// user still sees the correct diff in Changes tab.
const fileStatusLetter = (f: GitFileDiff): string => {
  if (f.oldPath && f.oldPath !== f.path) return 'R'
  if (f.isBinary) return 'B'
  return 'M'
}

const fileStatusLabel = (f: GitFileDiff): string => {
  if (f.oldPath && f.oldPath !== f.path) return `Renamed from ${f.oldPath ?? '?'}`
  if (f.isBinary) return 'Binary'
  return 'Modified'
}

const fileStatusStyle = (f: GitFileDiff) => {
  const tk = t.value
  if (f.oldPath && f.oldPath !== f.path) {
    return { background: tk.infoBg, color: tk.info, border: `1px solid ${tk.infoBorder}` }
  }
  return { background: tk.bgInput, color: tk.gitModified, border: `1px solid ${tk.border}` }
}

const initials = (name: string): string => {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase()
}

const formatDateTime = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

// Pretty relative date — short form (just now / 5m / 2h / 3d / 4w / 6mo / 2y).
const relativeDate = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const diff = Date.now() - d.getTime()
  const sec = Math.round(diff / 1000)
  if (sec < 60) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`
  const wk = Math.round(day / 7)
  if (wk < 5) return `${wk}w ago`
  const mo = Math.round(day / 30)
  if (mo < 12) return `${mo}mo ago`
  const yr = Math.round(day / 365)
  return `${yr}y ago`
}

const onCopyHash = (s: string) => {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  navigator.clipboard.writeText(s).catch(() => undefined)
}

const onSelectTreeFile = (idx: number, path: string) => {
  activeFileIndex.value = idx
  emit('select-file', path)
  activeTab.value = 'changes'
}

const onSelectFile = (idx: number) => {
  activeFileIndex.value = idx
  const f = props.detail?.files[idx]
  if (f) emit('select-file', f.path)
}

// ── Tree pane width resize ────────────────────────────────────────────────
const TREE_WIDTH_KEY = 'awog.git.commit-changes-tree-width'
const DEFAULT_TREE_WIDTH = 260
const MIN_TREE_WIDTH = 180
const MAX_TREE_WIDTH = 480

const readStoredTreeWidth = (): number => {
  if (typeof window === 'undefined') return DEFAULT_TREE_WIDTH
  const raw = window.localStorage.getItem(TREE_WIDTH_KEY)
  if (!raw) return DEFAULT_TREE_WIDTH
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_TREE_WIDTH
  return Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, n))
}

const treeWidth = ref<number>(readStoredTreeWidth())
const dragging = ref(false)

let dragStartX = 0
let dragStartWidth = 0

const onDragMove = (e: MouseEvent) => {
  const next = Math.max(
    MIN_TREE_WIDTH,
    Math.min(MAX_TREE_WIDTH, dragStartWidth + (e.clientX - dragStartX)),
  )
  treeWidth.value = next
}

const onDragEnd = () => {
  if (!dragging.value) return
  dragging.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
  try {
    window.localStorage.setItem(TREE_WIDTH_KEY, String(treeWidth.value))
  } catch {
    // ignore quota / privacy errors
  }
}

const onDragStart = (e: MouseEvent) => {
  e.preventDefault()
  dragStartX = e.clientX
  dragStartWidth = treeWidth.value
  dragging.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
}

const resetTreeWidth = () => {
  treeWidth.value = DEFAULT_TREE_WIDTH
  try {
    window.localStorage.removeItem(TREE_WIDTH_KEY)
  } catch {
    // ignore
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
})
</script>
