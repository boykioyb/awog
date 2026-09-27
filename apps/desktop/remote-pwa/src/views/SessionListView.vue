<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, Settings, SquarePen, X } from 'lucide-vue-next'
import {
  activeTurnIds,
  awaitingCount,
  clearSearch,
  deleteSession,
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
import { usePullToRefresh, useScrollCollapse } from '../gestures'
import { relTime } from '../util'
import NavBar from '../components/NavBar.vue'
import NewSessionSheet from '../components/NewSessionSheet.vue'
import SettingsSheet from '../components/SettingsSheet.vue'
import SwipeRow from '../components/SwipeRow.vue'
import type { SessionSummary } from '../types'

const filter = ref<string>('all')
const query = ref('')
const creating = ref(false)
const settingsOpen = ref(false)
const openRowId = ref<string | null>(null)

const scroller = ref<HTMLElement | null>(null)
const { pull, refreshing, engaged, threshold } = usePullToRefresh(scroller, loadSessions)
const collapsed = useScrollCollapse(scroller)

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
    <NavBar title="Sessions" large :collapsed="collapsed">
      <template #trailing>
        <button
          class="navbtn"
          title="Cài đặt"
          aria-label="Cài đặt"
          @click="settingsOpen = true"
        >
          <Settings class="icn-lg" />
        </button>
        <button
          class="navbtn"
          title="Session mới"
          aria-label="Session mới"
          @click="creating = true"
        >
          <SquarePen class="icn-lg" />
        </button>
      </template>
    </NavBar>

    <div ref="scroller" class="scroll">
      <div
        class="ptr"
        :style="{
          height: `${refreshing ? 44 : pull}px`,
          transition: engaged ? 'none' : 'height .18s ease',
        }"
      >
        <span v-if="refreshing" class="spin" />
        <ChevronDown v-else class="icn-md" :class="{ met: pull >= threshold }" />
      </div>

      <h1 class="big">
        Sessions
        <span v-if="awaitingCount" class="badge awaiting gate">{{ awaitingCount }} chờ duyệt</span>
      </h1>

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
        <button class="chip" :class="{ on: filter === 'all' }" @click="filter = 'all'">
          Tất cả
        </button>
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
        <ul v-else-if="listLoading && !sessions.length" class="rows">
          <li v-for="i in 5" :key="i" class="row skel-row">
            <div class="skel w60" />
            <div class="skel w40" />
          </li>
        </ul>
        <div v-else-if="!sessions.length" class="state muted">Chưa có session nào.</div>

        <ul v-else class="rows">
          <SwipeRow
            v-for="s in sessions"
            :key="s.id"
            :open="openRowId === s.id"
            @open="openRowId = s.id"
            @close="openRowId = null"
            @tap="openSession(s)"
            @del="deleteSession(s.id)"
          >
            <div class="row">
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
                  :style="
                    projectColor(s.projectId) ? { color: projectColor(s.projectId)! } : undefined
                  "
                >
                  {{ projectName(s.projectId) }}
                </span>
                <span class="preview muted">{{ s.lastPreview || `${s.messageCount} tin nhắn` }}</span>
              </div>
            </div>
          </SwipeRow>
        </ul>
      </template>
    </div>

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
  position: relative;
}
.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  /* Chrome's own pull-to-reload must not fight our pull-to-refresh. */
  overscroll-behavior-y: contain;
}
.gate {
  background: color-mix(in srgb, var(--warn) 22%, transparent);
  color: var(--warn);
  vertical-align: 2px;
  margin-left: 8px;
}
.search {
  position: relative;
  flex: 0 0 auto;
  padding: 0 12px 8px;
}
.search input {
  width: 100%;
  min-height: 40px;
  background: var(--surface-2);
  border: 1px solid transparent;
  border-radius: var(--r-btn);
  padding: 8px 48px 8px 16px;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.search input:focus {
  border-color: var(--accent);
}
/* Stretched to the field's own height so the hit box stays 44 wide × tall
   without a bigger glyph. */
.clear {
  position: absolute;
  right: 12px;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--tap);
  height: 40px;
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
/* Filter chips are selectors in a scroll row, not actions — 32px, with the
   ::before giving each one back its 44px touch target. */
.chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  min-height: 32px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  border-radius: var(--r-btn);
  padding: 0 12px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.chip::before {
  content: '';
  position: absolute;
  inset: -6px -2px;
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
  padding: 40px 18px;
  justify-content: center;
}
.state.danger {
  color: var(--danger);
}
/* Plain-style rows: full-bleed, hairline separators, no card chrome — the
   Messages/Telegram look instead of a desktop card feed. */
.rows {
  list-style: none;
  margin: 0;
  padding: 0 0 16px;
}
.row {
  position: relative;
  padding: 11px 16px;
}
.row:active {
  background: var(--surface-2);
}
/* Inset hairline, iOS table-view style. */
.row::after {
  content: '';
  position: absolute;
  left: 16px;
  right: 0;
  bottom: 0;
  height: 1px;
  background: var(--border);
}
.row:last-child::after {
  display: none;
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
  margin-top: 4px;
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
.skel-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 14px;
  padding-bottom: 14px;
}
.skel-row .skel {
  height: 14px;
}
.w60 {
  width: 60%;
}
.w40 {
  width: 40%;
}
</style>
