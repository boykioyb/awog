<!--
  GitCommitFileTree.vue — File tree pane cho Changes tab của commit detail.
  Hỗ trợ 2 view mode: tree (nested, collapse single-child dir chains) & flat
  (full path list). Search filter case-insensitive theo `path`.

  Caller giữ activeFileIndex; component chỉ emit `select-file [index]`.
-->
<template>
  <div class="flex flex-col h-full overflow-hidden" :style="{ background: t.bgPanel }">
    <!-- Toolbar: search + view mode toggle -->
    <div
      class="flex items-center gap-1 px-2 py-1.5 flex-shrink-0"
      :style="{ borderBottom: `1px solid ${t.border}` }"
    >
      <div
        class="flex-1 flex items-center gap-1 px-2 rounded"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
      >
        <Search :size="11" :style="{ color: t.textFaint }" />
        <input
          v-model="query"
          type="text"
          placeholder="Filter files..."
          class="flex-1 bg-transparent outline-none text-[1em] py-1"
          :style="{ color: t.text }"
        />
        <button
          v-if="query"
          type="button"
          class="p-0.5 rounded transition"
          :style="{ color: t.textFaint }"
          title="Clear"
          @click="query = ''"
        >
          <X :size="10" />
        </button>
      </div>
      <div
        class="flex items-center rounded overflow-hidden flex-shrink-0"
        :style="{ border: `1px solid ${t.border}` }"
      >
        <button
          type="button"
          class="px-1.5 py-1 transition"
          :style="modeBtnStyle('tree')"
          title="Tree view"
          @click="viewMode = 'tree'"
        >
          <Grid2x2 :size="11" />
        </button>
        <button
          type="button"
          class="px-1.5 py-1 transition"
          :style="modeBtnStyle('flat')"
          title="Flat list"
          @click="viewMode = 'flat'"
        >
          <List :size="11" />
        </button>
      </div>
    </div>

    <!-- Body -->
    <div class="flex-1 overflow-y-auto py-1">
      <div
        v-if="visibleFiles.length === 0"
        class="flex items-center justify-center h-full text-[1em] px-3 text-center"
        :style="{ color: t.textDim }"
      >
        {{ query ? 'No files match filter' : 'No files' }}
      </div>

      <!-- Tree view -->
      <template v-else-if="viewMode === 'tree'">
        <template v-for="row in treeRows" :key="row.id">
          <button
            v-if="row.kind === 'dir'"
            type="button"
            class="w-full flex items-center gap-1 py-1 text-left text-[1em] transition truncate"
            :style="{
              paddingLeft: `${8 + row.depth * 12}px`,
              paddingRight: '8px',
              color: t.textMuted,
              background: 'transparent',
            }"
            @click="toggleDir(row.path)"
          >
            <ChevronDown
              v-if="!collapsed.has(row.path)"
              :size="11"
              :style="{ color: t.textFaint, flexShrink: 0 }"
            />
            <ChevronRight v-else :size="11" :style="{ color: t.textFaint, flexShrink: 0 }" />
            <FolderOpen
              v-if="!collapsed.has(row.path)"
              :size="12"
              :style="{ color: t.textDim, flexShrink: 0 }"
            />
            <Folder v-else :size="12" :style="{ color: t.textDim, flexShrink: 0 }" />
            <span class="truncate">{{ row.label }}</span>
          </button>
          <button
            v-else
            type="button"
            class="w-full flex items-center gap-1.5 py-1 text-left text-[1em] transition truncate"
            :style="fileRowStyle(row.fileIndex)"
            @click="onSelectFile(row.fileIndex)"
          >
            <span
              class="inline-flex items-center justify-center text-[1em] rounded flex-shrink-0 font-mono"
              :style="{
                width: '14px',
                height: '14px',
                marginLeft: `${row.depth * 12}px`,
                ...statusBadgeStyle(detail.files[row.fileIndex]!),
              }"
              :title="statusLabel(detail.files[row.fileIndex]!)"
            >
              {{ statusLetter(detail.files[row.fileIndex]!) }}
            </span>
            <span class="truncate" :style="{ color: t.text }">{{ row.label }}</span>
          </button>
        </template>
      </template>

      <!-- Flat view -->
      <template v-else>
        <button
          v-for="idx in visibleFiles"
          :key="detail.files[idx]!.path"
          type="button"
          class="w-full flex items-center gap-1.5 px-2 py-1 text-left text-[1em] font-mono transition truncate"
          :style="fileRowStyle(idx)"
          :title="detail.files[idx]!.path"
          @click="onSelectFile(idx)"
        >
          <span
            class="inline-flex items-center justify-center text-[1em] rounded flex-shrink-0 font-mono"
            :style="{ width: '14px', height: '14px', ...statusBadgeStyle(detail.files[idx]!) }"
            :title="statusLabel(detail.files[idx]!)"
          >
            {{ statusLetter(detail.files[idx]!) }}
          </span>
          <span class="truncate" :style="{ color: t.text }">{{ detail.files[idx]!.path }}</span>
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Grid2x2,
  List,
  Search,
  X,
} from 'lucide-vue-next'
import type { GitFileDiff } from '~/types'

type Props = {
  detail: { files: GitFileDiff[] }
  activeFileIndex: number
}

const props = defineProps<Props>()
const emit = defineEmits<{ 'select-file': [index: number] }>()

const { t } = useTheme()

type ViewMode = 'tree' | 'flat'
const viewMode = ref<ViewMode>('tree')
const query = ref('')
const collapsed = ref<Set<string>>(new Set())

const modeBtnStyle = (mode: ViewMode) => ({
  background: viewMode.value === mode ? t.value.accent : t.value.bgPanel,
  color: viewMode.value === mode ? t.value.accentText : t.value.textMuted,
  cursor: 'pointer',
})

const fileRowStyle = (idx: number) => {
  const active = props.activeFileIndex === idx
  return {
    background: active ? t.value.bgActive : 'transparent',
    borderLeft: `2px solid ${active ? t.value.accent : 'transparent'}`,
  }
}

// ── Status helpers ────────────────────────────────────────────────────────
// Same heuristic as before: sidecar GitFileDiff doesn't carry explicit status.
const statusLetter = (f: GitFileDiff): string => {
  if (f.oldPath && f.oldPath !== f.path) return 'R'
  if (f.isBinary) return 'B'
  return 'M'
}

const statusLabel = (f: GitFileDiff): string => {
  if (f.oldPath && f.oldPath !== f.path) return `Renamed from ${f.oldPath}`
  if (f.isBinary) return 'Binary'
  return 'Modified'
}

const statusBadgeStyle = (f: GitFileDiff) => {
  const tk = t.value
  if (f.oldPath && f.oldPath !== f.path) {
    return { background: tk.infoBg, color: tk.info, border: `1px solid ${tk.infoBorder}` }
  }
  return {
    background: tk.warningBg,
    color: tk.gitModified,
    border: `1px solid ${tk.warningBorder}`,
  }
}

// ── Filter ────────────────────────────────────────────────────────────────
const visibleFiles = computed<number[]>(() => {
  const q = query.value.trim().toLowerCase()
  const out: number[] = []
  props.detail.files.forEach((f, i) => {
    if (!q || f.path.toLowerCase().includes(q)) out.push(i)
  })
  return out
})

// ── Tree build ────────────────────────────────────────────────────────────
type TreeRow =
  | { kind: 'dir'; id: string; path: string; label: string; depth: number }
  | { kind: 'file'; id: string; path: string; label: string; depth: number; fileIndex: number }

type RawNode = {
  name: string
  fullPath: string
  files: { idx: number; segs: string[]; depth: number }[]
  children: Map<string, RawNode>
}

const treeRows = computed<TreeRow[]>(() => {
  // Build raw tree from visibleFiles.
  const root: RawNode = { name: '', fullPath: '', files: [], children: new Map() }
  visibleFiles.value.forEach((idx) => {
    const filePath = props.detail.files[idx]!.path
    const segs = filePath.split('/')
    let cur = root
    for (let i = 0; i < segs.length - 1; i += 1) {
      const seg = segs[i]!
      let next = cur.children.get(seg)
      if (!next) {
        const prefix = cur.fullPath ? `${cur.fullPath}/${seg}` : seg
        next = { name: seg, fullPath: prefix, files: [], children: new Map() }
        cur.children.set(seg, next)
      }
      cur = next
    }
    cur.files.push({ idx, segs, depth: 0 })
  })

  const rows: TreeRow[] = []
  // DFS emitting rows; collapse single-child dir chains: a dir with exactly 1
  // sub-dir and 0 files merges with that child as "a/b" label.
  const walk = (node: RawNode, depth: number) => {
    const subDirs = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name))
    const files = [...node.files].sort((a, b) =>
      (a.segs.at(-1) ?? '').localeCompare(b.segs.at(-1) ?? ''),
    )

    subDirs.forEach((dir) => {
      // Single-child dir collapse: combine consecutive dirs with exactly 1 child
      // and no files into one row "dir1/dir2/dir3".
      let cur = dir
      let label = cur.name
      let dirPath = cur.fullPath
      while (cur.children.size === 1 && cur.files.length === 0) {
        const [onlyChild] = [...cur.children.values()]
        if (!onlyChild) break
        cur = onlyChild
        label = `${label}/${cur.name}`
        dirPath = cur.fullPath
      }
      const isCollapsed = collapsed.value.has(dirPath)
      rows.push({ kind: 'dir', id: `d:${dirPath}`, path: dirPath, label, depth })
      if (!isCollapsed) walk(cur, depth + 1)
    })
    files.forEach((f) => {
      const filePath = props.detail.files[f.idx]!.path
      const leaf = filePath.split('/').at(-1) ?? filePath
      rows.push({
        kind: 'file',
        id: `f:${filePath}`,
        path: filePath,
        label: leaf,
        depth,
        fileIndex: f.idx,
      })
    })
  }
  walk(root, 0)
  return rows
})

const toggleDir = (path: string) => {
  const next = new Set(collapsed.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  collapsed.value = next
}

const onSelectFile = (idx: number) => {
  emit('select-file', idx)
}
</script>
