<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, FileText, Folder, Link } from 'lucide-vue-next'
import { gateway } from '../gateway'
import { errMsg } from '../util'
import AppSheet from './AppSheet.vue'
import type { SftpEntry } from '../types'

// Remote file tree over an OPEN ssh connection — lazy per-directory like the
// workspace FilesPanel, except paths are absolute on the remote host and reads
// come back base64 (ssh.sftp.read), decoded for text preview.

const props = defineProps<{ connId: string }>()

const dirs = reactive(new Map<string, SftpEntry[]>())
const dirState = reactive(new Map<string, 'loading' | 'error' | undefined>())
const dirError = reactive(new Map<string, string>())
const expanded = reactive(new Set<string>())

const preview = ref<{ path: string; text: string; truncated: boolean } | null>(null)
const previewOpen = ref(false)
const previewLoading = ref(false)

// Remote paths are absolute; start at the SSH default landing dir ('.' resolves
// to the login home on every ssh2 SFTP server).
const ROOT = '.'

function joinPath(dir: string, name: string): string {
  return dir === ROOT || dir === '/' ? `/${name}` : `${dir}/${name}`
}

async function loadDir(path: string): Promise<void> {
  dirState.set(path, 'loading')
  dirError.delete(path)
  try {
    const res = (await gateway.request('ssh.sftp.list', { connId: props.connId, path })) as {
      entries: SftpEntry[]
    }
    // Dirs first, then name — same ordering fs.listDir produces.
    res.entries.sort((a, b) =>
      a.type === 'dir' && b.type !== 'dir' ? -1 : a.type !== 'dir' && b.type === 'dir' ? 1 : a.name.localeCompare(b.name),
    )
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

async function openFile(path: string): Promise<void> {
  previewLoading.value = true
  try {
    const res = (await gateway.request('ssh.sftp.read', {
      connId: props.connId,
      path,
      maxBytes: 256 * 1024,
    })) as { base64: string; truncated?: boolean }
    let text = ''
    try {
      text = atob(res.base64 ?? '')
    } catch {
      text = ''
    }
    preview.value = { path, text: text || '(không đọc được dạng text)', truncated: !!res.truncated }
    previewOpen.value = true
  } catch (e) {
    dirError.set(path, errMsg(e))
  } finally {
    previewLoading.value = false
  }
}

interface Row {
  name: string
  path: string
  entry: SftpEntry
  depth: number
}
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const walk = (dir: string, depth: number): void => {
    for (const e of dirs.get(dir) ?? []) {
      const path = joinPath(dir === ROOT ? '/' : dir, e.name)
      out.push({ name: e.name, path, entry: e, depth })
      if (e.type === 'dir' && expanded.has(path)) walk(path, depth + 1)
    }
  }
  walk(ROOT, 0)
  return out
})

function note(r: Row): { kind: 'loading' | 'error'; text: string } | null {
  if (r.entry.type === 'dir' && expanded.has(r.path)) {
    if (dirState.get(r.path) === 'loading') return { kind: 'loading', text: 'Đang tải…' }
    if (dirState.get(r.path) === 'error')
      return { kind: 'error', text: dirError.get(r.path) ?? 'Không đọc được' }
    if (dirs.get(r.path)?.length === 0) return { kind: 'loading', text: 'Thư mục trống' }
  }
  if (r.entry.type !== 'dir' && dirError.has(r.path))
    return { kind: 'error', text: dirError.get(r.path) ?? 'Không đọc được tệp' }
  return null
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

watch(
  () => props.connId,
  () => {
    dirs.clear()
    expanded.clear()
    void loadDir(ROOT)
  },
  { immediate: true },
)
</script>

<template>
  <div class="sftp">
    <div v-if="dirState.get(ROOT) === 'loading'" class="state"><span class="spin" /></div>
    <div v-else-if="dirState.get(ROOT) === 'error'" class="state danger">
      {{ dirError.get(ROOT) }}
      <button class="retry" @click="loadDir(ROOT)">Thử lại</button>
    </div>
    <ul v-else class="rows">
      <template v-for="r in rows" :key="r.path">
        <li>
          <button
            class="row"
            :style="{ paddingLeft: `${10 + r.depth * 16}px` }"
            @click="r.entry.type === 'dir' ? toggleDir(r.path) : openFile(r.path)"
          >
            <ChevronDown v-if="r.entry.type === 'dir' && expanded.has(r.path)" class="icn-md caret" />
            <ChevronRight v-else-if="r.entry.type === 'dir'" class="icn-md caret" />
            <span v-else class="caret" />
            <Folder v-if="r.entry.type === 'dir'" class="icn-md icon dir" />
            <Link v-else-if="r.entry.type === 'symlink'" class="icn-md icon" />
            <FileText v-else class="icn-md icon" />
            <span class="name">{{ r.name }}</span>
            <span v-if="r.entry.type !== 'dir'" class="size muted">{{ fmtSize(r.entry.size) }}</span>
          </button>
        </li>
        <li
          v-for="n in [note(r)].filter(Boolean)"
          :key="r.path + '-n'"
          class="note"
          :class="n!.kind"
          :style="{ paddingLeft: `${10 + (r.depth + 1) * 16 + 24}px` }"
        >
          <span v-if="n!.kind === 'loading'" class="spin" />
          {{ n!.text }}
          <button
            v-if="n!.kind === 'error' && r.entry.type === 'dir'"
            class="retry"
            @click.stop="loadDir(r.path)"
          >
            Thử lại
          </button>
        </li>
      </template>
    </ul>

    <AppSheet :open="previewOpen" :title="preview?.path.split('/').pop() ?? ''" @close="previewOpen = false">
      <template v-if="preview">
        <div class="pmeta muted">
          {{ preview.path }}<span v-if="preview.truncated"> · cắt bớt ở 256 KB</span>
        </div>
        <pre class="pcode">{{ preview.text }}</pre>
      </template>
    </AppSheet>
    <div v-if="previewLoading" class="pload"><span class="spin" /></div>
  </div>
</template>

<style scoped>
.sftp {
  min-height: 120px;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 46vh;
  overflow-y: auto;
  border-top: 1px solid var(--hairline);
  -webkit-overflow-scrolling: touch;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: var(--tap);
  padding: 0 10px;
  border: none;
  border-bottom: 1px solid var(--hairline);
  background: transparent;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
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
}
.note {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding-right: 10px;
  font-size: var(--fs-xs);
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
  padding: 28px 0;
  color: var(--text-dim);
}
.state.danger {
  color: var(--danger);
}
.pmeta {
  font-size: var(--fs-xs);
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
</style>
