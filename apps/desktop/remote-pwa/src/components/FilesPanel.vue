<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-vue-next'
import { gateway } from '../gateway'
import { errMsg } from '../util'
import AppSheet from './AppSheet.vue'
import type { FsEntry, FsFileContent } from '../types'

// Files tab of the session workspace — a lazy tree: each dir row loads its
// children on first expand (fs.listDir takes one directory at a time), taps on
// files open a read-only preview sheet (fs.readFile).

const props = defineProps<{ projectId: string }>()

// '' is the workspace root — fs.listDir treats an empty/omitted path as root.
type DirState = 'loading' | 'error' | undefined
const dirs = reactive(new Map<string, FsEntry[]>())
const dirState = reactive(new Map<string, DirState>())
const dirError = reactive(new Map<string, string>())
const expanded = reactive(new Set<string>())

const preview = ref<FsFileContent | null>(null)
const previewOpen = ref(false)
const previewLoading = ref(false)

async function loadDir(path: string): Promise<void> {
  dirState.set(path, 'loading')
  dirError.delete(path)
  try {
    const res = (await gateway.request('fs.listDir', { projectId: props.projectId, path })) as {
      entries: FsEntry[]
    }
    dirs.set(path, res.entries)
    dirState.set(path, undefined)
  } catch (e) {
    dirState.set(path, 'error')
    dirError.set(path, errMsg(e))
  }
}

function toggleDir(path: string): void {
  if (expanded.has(path)) {
    expanded.delete(path)
    return
  }
  expanded.add(path)
  if (!dirs.has(path) && dirState.get(path) !== 'loading') void loadDir(path)
}

async function openFile(entry: FsEntry): Promise<void> {
  previewLoading.value = true
  try {
    preview.value = (await gateway.request('fs.readFile', {
      projectId: props.projectId,
      path: entry.path,
      maxBytes: 256 * 1024,
    })) as FsFileContent
    previewOpen.value = true
  } catch (e) {
    dirError.set(entry.path, errMsg(e))
  } finally {
    previewLoading.value = false
  }
}

// Flatten the open dirs into the visible row list — one level per indent.
interface Row {
  entry: FsEntry
  depth: number
}
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const walk = (path: string, depth: number): void => {
    for (const e of dirs.get(path) ?? []) {
      out.push({ entry: e, depth })
      if (e.kind === 'dir' && expanded.has(e.path)) walk(e.path, depth + 1)
    }
  }
  walk('', 0)
  return out
})

// An error on a directory shows as a child row inside that dir; a file-read
// error parks on the file's own row.
function rowNote(r: Row): { kind: 'loading' | 'error'; text: string } | null {
  const e = r.entry
  if (e.kind === 'dir' && expanded.has(e.path)) {
    if (dirState.get(e.path) === 'loading') return { kind: 'loading', text: 'Đang tải…' }
    if (dirState.get(e.path) === 'error')
      return { kind: 'error', text: dirError.get(e.path) ?? 'Không đọc được thư mục' }
    if (dirs.get(e.path)?.length === 0) return { kind: 'loading', text: 'Thư mục trống' }
  }
  if (e.kind === 'file' && dirError.has(e.path))
    return { kind: 'error', text: dirError.get(e.path) ?? 'Không đọc được tệp' }
  return null
}

function fmtSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const previewTitle = computed(() => preview.value?.path.split('/').pop() ?? '')

onMounted(() => void loadDir(''))
</script>

<template>
  <div class="files">
    <div v-if="dirState.get('') === 'loading'" class="rows">
      <div v-for="i in 6" :key="i" class="row"><div class="skel w40" /></div>
    </div>
    <div v-else-if="dirState.get('') === 'error'" class="state danger">
      {{ dirError.get('') ?? 'Không đọc được thư mục' }}
      <button class="retry" @click="loadDir('')">Thử lại</button>
    </div>
    <div v-else-if="!rows.length" class="state muted">Thư mục trống.</div>

    <ul v-else class="rows">
      <template v-for="r in rows" :key="r.entry.path">
        <li>
          <button
            class="row"
            :style="{ paddingLeft: `${14 + r.depth * 18}px` }"
            @click="r.entry.kind === 'dir' ? toggleDir(r.entry.path) : openFile(r.entry)"
          >
            <ChevronDown
              v-if="r.entry.kind === 'dir' && expanded.has(r.entry.path)"
              class="icn-md caret"
            />
            <ChevronRight
              v-else-if="r.entry.kind === 'dir'"
              class="icn-md caret"
            />
            <span v-else class="caret" />
            <Folder v-if="r.entry.kind === 'dir'" class="icn-md icon dir" />
            <FileText v-else class="icn-md icon" />
            <span class="name">{{ r.entry.name }}</span>
            <span v-if="r.entry.kind === 'file'" class="size muted">{{ fmtSize(r.entry.size) }}</span>
          </button>
        </li>
        <li
          v-for="note in [rowNote(r)].filter(Boolean)"
          :key="r.entry.path + '-note'"
          class="note"
          :class="note!.kind"
          :style="{ paddingLeft: `${14 + (r.depth + 1) * 18 + 24}px` }"
        >
          <span v-if="note!.kind === 'loading'" class="spin" />
          {{ note!.text }}
          <button
            v-if="note!.kind === 'error' && r.entry.kind === 'dir'"
            class="retry"
            @click.stop="loadDir(r.entry.path)"
          >
            Thử lại
          </button>
        </li>
      </template>
    </ul>

    <AppSheet :open="previewOpen" :title="previewTitle" @close="previewOpen = false">
      <div v-if="preview?.isBinary" class="state muted">Tệp nhị phân — không xem trước được.</div>
      <template v-else-if="preview">
        <div class="pmeta muted">
          {{ preview.path }}
          <span v-if="preview.truncated"> · cắt bớt ở 256 KB</span>
        </div>
        <pre class="pcode">{{ preview.content }}</pre>
      </template>
      <div v-else class="state"><span class="spin" /></div>
    </AppSheet>
    <div v-if="previewLoading" class="pload"><span class="spin" /></div>
  </div>
</template>

<style scoped>
.files {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
/* Same full-bleed hairline rows as the session list. */
.rows {
  list-style: none;
  margin: 0;
  padding: 0 0 20px;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: var(--tap);
  padding: 0 14px;
  border: none;
  border-bottom: 1px solid var(--hairline);
  background: transparent;
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  text-align: left;
}
.row:active {
  background: var(--surface-2);
}
.caret {
  width: 16px;
  flex-shrink: 0;
  color: var(--text-faint);
}
.icon {
  flex-shrink: 0;
  color: var(--text-dim);
}
.icon.dir {
  color: var(--accent);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.size {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.note {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding-right: 14px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text-dim);
  border-bottom: 1px solid var(--hairline);
}
.note.error {
  color: var(--danger);
}
.retry {
  border: none;
  background: transparent;
  color: var(--accent);
  font-weight: 600;
  font-size: var(--fs-sm);
  padding: 4px 6px;
}
.state {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  padding: 40px 0;
  color: var(--text-dim);
}
.state.danger {
  color: var(--danger);
}
/* Read-only preview: relative-path header + mono scroll, same idea as the
   StepDetail file block but full-sheet. */
.pmeta {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  padding: 0 2px 8px;
  overflow-wrap: anywhere;
}
.pcode {
  margin: 0;
  max-height: 55vh;
  overflow: auto;
  background: var(--surface-2);
  border-radius: var(--r-sm);
  padding: 10px 12px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-family: var(--mono);
  white-space: pre;
}
.pload {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.skel {
  height: 14px;
  border-radius: var(--r-xs);
  background: var(--surface-2);
}
.w40 {
  width: 40%;
}
</style>
