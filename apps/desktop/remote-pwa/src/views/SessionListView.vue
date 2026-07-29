<script setup lang="ts">
import { computed } from 'vue'
import { activeTurnIds, listError, listLoading, loadSessions, openSession, sessionList } from '../store'
import { relTime } from '../util'
import type { SessionSummary } from '../types'

const sessions = computed(() => sessionList.value)

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
      <button class="refresh" :disabled="listLoading" title="Làm mới" @click="loadSessions">
        <span v-if="listLoading" class="spin" />
        <span v-else>↻</span>
      </button>
    </header>

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
          <span class="preview muted">{{ s.lastPreview || `${s.messageCount} tin nhắn` }}</span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.list {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 10px;
  position: sticky;
  top: 0;
  background: var(--bg);
  z-index: 1;
}
.head h1 {
  font-size: 22px;
  margin: 0;
}
.refresh {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: 18px;
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
.rows {
  list-style: none;
  margin: 0;
  padding: 0 12px 20px;
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
}
.preview {
  font-size: 13px;
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
</style>
