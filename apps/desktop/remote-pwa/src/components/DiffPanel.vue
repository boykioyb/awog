<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { gateway } from '../gateway'
import { turnDoneSignal } from '../store'
import { errMsg } from '../util'
import type { GitDiff, GitFileDiff, GitFileStatus, GitStatus } from '../types'

const props = defineProps<{ projectId: string }>()

const loading = ref(false)
const error = ref<string | null>(null)
const files = ref<GitFileStatus[]>([])
const diffByPath = ref<Map<string, GitFileDiff>>(new Map())
const branch = ref<string | null>(null)
const expanded = ref<Set<string>>(new Set())

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [status, diff] = await Promise.all([
      gateway.request<GitStatus>('git.status', { projectId: props.projectId }),
      gateway
        .request<GitDiff>('git.diff', { projectId: props.projectId, kind: 'workingTree' })
        .catch(() => ({ files: [] as GitFileDiff[] })),
    ])
    branch.value = status.branch
    files.value = status.files
    diffByPath.value = new Map(diff.files.map((f) => [f.path, f]))
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    loading.value = false
  }
}

function toggle(path: string): void {
  const set = new Set(expanded.value)
  if (set.has(path)) set.delete(path)
  else set.add(path)
  expanded.value = set
}

function symbol(f: GitFileStatus): string {
  switch (f.changeType) {
    case 'added':
    case 'untracked':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'conflicted':
      return '!'
    default:
      return 'M'
  }
}

onMounted(load)
watch(() => turnDoneSignal.value, load)
watch(() => props.projectId, load)
</script>

<template>
  <div class="diff">
    <div class="bar">
      <span class="branch muted">{{ branch ? `⎇ ${branch}` : 'Changes' }}</span>
      <button class="refresh" :disabled="loading" title="Làm mới" @click="load">
        <span v-if="loading" class="spin" />
        <span v-else>↻</span>
      </button>
    </div>

    <div v-if="error" class="state danger">{{ error }}</div>
    <div v-else-if="loading && !files.length" class="state"><span class="spin" /> Đang tải…</div>
    <div v-else-if="!files.length" class="state muted">Không có thay đổi.</div>

    <ul v-else class="files">
      <li v-for="f in files" :key="f.path" class="file">
        <button class="file-head" @click="toggle(f.path)">
          <span class="sym" :class="f.changeType">{{ symbol(f) }}</span>
          <span class="path">{{ f.path }}</span>
          <span v-if="f.additions" class="add">+{{ f.additions }}</span>
          <span v-if="f.deletions" class="del">−{{ f.deletions }}</span>
        </button>

        <div v-if="expanded.has(f.path) && diffByPath.get(f.path)" class="hunks">
          <template v-for="(h, hi) in diffByPath.get(f.path)!.hunks" :key="hi">
            <div class="hunk-head">{{ h.header }}</div>
            <div
              v-for="(ln, li) in h.lines"
              :key="li"
              class="ln"
              :class="ln.kind"
            >{{ ln.kind === 'add' ? '+' : ln.kind === 'del' ? '-' : ' ' }}{{ ln.content }}</div>
          </template>
        </div>
        <div v-else-if="expanded.has(f.path)" class="no-hunk muted">
          {{ f.isBinary ? 'Tệp nhị phân' : 'Không có diff hiển thị' }}
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.diff {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--bg);
}
.branch {
  font-size: 13px;
  font-family: var(--mono);
}
.refresh {
  width: 30px;
  height: 30px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  color: var(--text-dim);
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
.files {
  list-style: none;
  margin: 0;
  padding: 8px 10px 20px;
}
.file {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  margin-bottom: 6px;
  overflow: hidden;
}
.file-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  background: var(--surface);
  border: none;
  color: var(--text);
  padding: 9px 11px;
}
.sym {
  font-family: var(--mono);
  font-weight: 700;
  font-size: 12px;
  width: 16px;
  flex-shrink: 0;
  color: var(--warn);
}
.sym.added,
.sym.untracked {
  color: var(--add);
}
.sym.deleted {
  color: var(--del);
}
.path {
  flex: 1;
  font-family: var(--mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.add {
  color: var(--add);
  font-family: var(--mono);
  font-size: 12px;
}
.del {
  color: var(--del);
  font-family: var(--mono);
  font-size: 12px;
}
.hunks {
  background: var(--surface-2);
  border-top: 1px solid var(--border);
  overflow-x: auto;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.5;
}
.hunk-head {
  color: var(--text-faint);
  padding: 3px 10px;
  background: var(--surface-3);
}
.ln {
  padding: 0 10px;
  white-space: pre;
}
.ln.add {
  color: var(--add);
  background: color-mix(in srgb, var(--add) 10%, transparent);
}
.ln.del {
  color: var(--del);
  background: color-mix(in srgb, var(--del) 10%, transparent);
}
.no-hunk {
  padding: 8px 12px;
  font-size: 13px;
  border-top: 1px solid var(--border);
}
</style>
