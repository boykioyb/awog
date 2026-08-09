<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
      <button class="icon" :disabled="listLoading" title="Làm mới" @click="loadSessions">
        <span v-if="listLoading" class="spin" />
        <span v-else>↻</span>
      </button>
      <button class="icon" title="Cài đặt" @click="settingsOpen = true">⚙</button>
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
      <button v-if="query" class="clear" title="Xoá" @click="query = ''">✕</button>
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

    <button class="fab" title="Session mới" @click="creating = true">+</button>

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
  gap: 8px;
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
  font-size: 22px;
  margin: 0;
  flex: 1;
}
.gate {
  background: color-mix(in srgb, var(--warn) 22%, transparent);
  color: var(--warn);
}
.icon {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: 16px;
}
.search {
  position: relative;
  flex: 0 0 auto;
  padding: 0 12px 8px;
}
.search input {
  width: 100%;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 9px 34px 9px 14px;
  outline: none;
  font-size: 15px;
}
.search input:focus {
  border-color: var(--accent);
}
.clear {
  position: absolute;
  right: 20px;
  top: 6px;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 13px;
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
  flex: 0 0 auto;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 13px;
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
  border-radius: var(--radius);
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
  font-size: 12px;
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
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  flex-shrink: 0;
}
.preview {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.snippet {
  margin-top: 5px;
  font-size: 13px;
  font-family: var(--mono);
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
  width: 54px;
  height: 54px;
  border-radius: 50%;
  border: none;
  background: var(--accent);
  color: #04120d;
  font-size: 30px;
  font-weight: 300;
  line-height: 1;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
  z-index: 3;
}
</style>
