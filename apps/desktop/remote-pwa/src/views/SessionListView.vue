<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ListTodo, Plus, RefreshCw, Settings, X } from 'lucide-vue-next'
import {
  activeTurnIds,
  awaitingCount,
  clearSearch,
  listError,
  listLoading,
  loadSessions,
  openSession,
  openSessionById,
  runSearch,
  searchLoading,
  route,
  searchResults,
  sessionList,
} from '../store'
import { projectColor, projectName, projects } from '../catalog'
import { relTime } from '../util'
import NewSessionSheet from '../components/NewSessionSheet.vue'
import SettingsSheet from '../components/SettingsSheet.vue'
import type { SessionSummary } from '../types'

const filter = ref<string>('all')
const query = ref('')
const creating = ref(false)
const settingsOpen = ref(false)

// Debounce the full-text search — every keystroke would otherwise fold every
// session's JSONL on the desktop (sessions.search is the one heavy read).
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(query, (q) => {
  if (searchTimer) clearTimeout(searchTimer)
  if (!q.trim()) {
    clearSearch()
    return
  }
  searchTimer = setTimeout(() => void runSearch(q), 350)
})

const searching = computed(() => query.value.trim().length >= 2)

// Only offer project chips that actually have sessions — a phone screen is narrow.
const chips = computed(() => {
  const used = new Set(sessionList.value.map((s) => s.projectId).filter(Boolean) as string[])
  return projects.value.filter((p) => used.has(p.id))
})

const sessions = computed(() => {
  if (filter.value === 'all') return sessionList.value
  if (filter.value === 'none') return sessionList.value.filter((s) => !s.projectId)
  return sessionList.value.filter((s) => s.projectId === filter.value)
})

function statusLabel(s: SessionSummary): { text: string; cls: string } | null {
  if (activeTurnIds.value.has(s.id)) return { text: 'Đang chạy', cls: 'running' }
  if (s.status === 'awaiting') return { text: 'Chờ duyệt', cls: 'awaiting' }
  if (s.status === 'error') return { text: 'Lỗi', cls: 'error' }
  return null
}
</script>

<template>
  <div class="list">
    <header class="head">
      <h1>Sessions</h1>
      <span v-if="awaitingCount" class="badge awaiting gate">{{ awaitingCount }} chờ duyệt</span>
      <button
        class="icon"
        :disabled="listLoading"
        title="Làm mới"
        aria-label="Làm mới danh sách session"
        @click="loadSessions"
      >
        <span v-if="listLoading" class="spin" />
        <RefreshCw v-else />
      </button>
      <button class="icon" title="Tasks" aria-label="Mở Tasks" @click="route = 'tasks'">
        <ListTodo />
      </button>
      <button
        class="icon"
        title="Cài đặt"
        aria-label="Cài đặt"
        @click="settingsOpen = true"
      >
        <Settings />
      </button>
    </header>

    <div class="search">
      <input
        v-model="query"
        type="search"
        inputmode="search"
        placeholder="Tìm trong transcript…"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
      />
      <button
        v-if="query"
        class="clear"
        title="Xoá"
        aria-label="Xoá từ khoá"
        @click="query = ''"
      >
        <X class="icn-sm" />
      </button>
    </div>

    <div v-if="!searching && chips.length" class="chips">
      <button class="chip" :class="{ on: filter === 'all' }" @click="filter = 'all'">Tất cả</button>
      <button
        v-for="p in chips"
        :key="p.id"
        class="chip"
        :class="{ on: filter === p.id }"
        :style="p.color ? { borderColor: filter === p.id ? p.color : undefined } : undefined"
        @click="filter = p.id"
      >
        {{ p.name }}
      </button>
      <button class="chip" :class="{ on: filter === 'none' }" @click="filter = 'none'">
        Không project
      </button>
    </div>

    <!-- Search results (one row per matched message) -->
    <template v-if="searching">
      <div v-if="searchLoading" class="state"><span class="spin" /><span>Đang tìm…</span></div>
      <div v-else-if="!searchResults.length" class="state muted">Không có kết quả.</div>
      <ul v-else class="rows">
        <li
          v-for="r in searchResults"
          :key="`${r.sessionId}-${r.messageId}`"
          class="row"
          @click="openSessionById(r.sessionId, r.sessionTitle)"
        >
          <div class="row-top">
            <span class="title">{{ r.sessionTitle || 'Không tiêu đề' }}</span>
            <span class="time muted">{{ relTime(r.at) }}</span>
          </div>
          <div class="snippet muted">{{ r.snippet }}</div>
        </li>
      </ul>
    </template>

    <!-- Normal list -->
    <template v-else>
      <div v-if="listError" class="state danger">{{ listError }}</div>
      <div v-else-if="listLoading && !sessions.length" class="state">
        <span class="spin" />
        <span>Đang tải…</span>
      </div>
      <div v-else-if="!sessions.length" class="state muted">Chưa có session nào.</div>

      <ul v-else class="rows">
        <li v-for="s in sessions" :key="s.id" class="row" @click="openSession(s)">
          <div class="row-top">
            <span class="title">{{ s.title || 'Không tiêu đề' }}</span>
            <span class="time muted">{{ relTime(s.updatedAt) }}</span>
          </div>
          <div class="row-bot">
            <span v-if="statusLabel(s)" class="badge" :class="statusLabel(s)!.cls">
              {{ statusLabel(s)!.text }}
            </span>
            <span
              v-if="s.projectId"
              class="proj"
              :style="projectColor(s.projectId) ? { color: projectColor(s.projectId)! } : undefined"
            >
              {{ projectName(s.projectId) }}
            </span>
            <span class="preview muted">{{ s.lastPreview || `${s.messageCount} tin nhắn` }}</span>
          </div>
        </li>
      </ul>
    </template>

    <button class="fab" title="Session mới" aria-label="Session mới" @click="creating = true">
      <Plus class="icn-lg" />
    </button>

    <NewSessionSheet :open="creating" @close="creating = false" />
    <SettingsSheet :open="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>

<style scoped>
.list {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  position: relative;
}
.head {
  display: flex;
  align-items: center;
  gap: 6px;
  /* In a flex COLUMN, flex-shrink works on the height: the tall `.rows` list
     would otherwise squash these auto-height rows to nothing (the chips row
     vanished entirely) instead of scrolling. */
  flex: 0 0 auto;
  padding: 14px 14px 8px;
  position: sticky;
  top: 0;
  background: var(--bg);
  z-index: 2;
}
.head h1 {
  /* min-width:0 + ellipsis so the row still fits when the 44px hit boxes and the
     gate badge are all present on a 375px screen. */
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--fs-2xl);
  line-height: var(--lh-2xl);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gate {
  background: color-mix(in srgb, var(--warn) 22%, transparent);
  color: var(--warn);
}
.icon {
  width: var(--tap);
  height: var(--tap);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: var(--r-btn);
  color: var(--text-dim);
}
.icon:active {
  background: var(--surface-3);
  color: var(--text);
}
.icon:disabled {
  opacity: 0.45;
}
.search {
  position: relative;
  flex: 0 0 auto;
  padding: 0 12px 8px;
}
.search input {
  width: 100%;
  min-height: var(--tap);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  padding: 9px 48px 9px 16px;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.search input:focus {
  border-color: var(--accent);
}
/* Stretched to the field's own height so the hit box is 44 wide × 44 tall
   without a bigger glyph or a taller row. */
.clear {
  position: absolute;
  right: 12px;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--tap);
  height: var(--tap);
  border: none;
  background: transparent;
  color: var(--text-dim);
}
.clear:active {
  color: var(--text);
}
.chips {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
  padding: 0 12px 10px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.chip {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  min-height: var(--tap);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  border-radius: var(--r-pill);
  padding: 0 14px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.chip:active {
  background: var(--surface-2);
}
.chip.on {
  color: var(--accent);
  border-color: var(--accent);
}
.state {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  padding: 40px 18px;
  justify-content: center;
}
.state.danger {
  color: var(--danger);
}
.rows {
  list-style: none;
  margin: 0;
  flex: 0 0 auto;
  padding: 0 12px 88px;
}
.row {
  padding: 13px 14px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: var(--r-card);
  margin-bottom: 8px;
}
.row:active {
  background: var(--surface-2);
}
.row-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.time {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  flex-shrink: 0;
}
.row-bot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  overflow: hidden;
}
.proj {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--text-dim);
  flex-shrink: 0;
}
.preview {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* No mono: this is a sentence out of the transcript, i.e. prose to read — not a
   path or a command to copy. */
.snippet {
  margin-top: 5px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge.running {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent);
}
.badge.awaiting {
  background: color-mix(in srgb, var(--warn) 22%, transparent);
  color: var(--warn);
}
.badge.error {
  background: color-mix(in srgb, var(--danger) 22%, transparent);
  color: var(--danger);
}
.fab {
  position: fixed;
  right: 18px;
  bottom: calc(22px + var(--sab, env(safe-area-inset-bottom)) + var(--kb, 0px));
  display: flex;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  border: none;
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: var(--shadow-1);
  z-index: 3;
}
.fab:active {
  background: color-mix(in srgb, var(--accent) 80%, black);
}
</style>
