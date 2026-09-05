<template>
  <div class="wstasks">
    <div v-if="!entries.length" class="empty" style="padding: 30px">
      <div class="et">{{ t('sessions.workspace.tasks.placeholder') }}</div>
    </div>

    <div v-else class="wstasks-list">
      <button
        v-for="entry in entries"
        :key="entry.id"
        class="wstasks-row"
        @click="openTask(entry.id)"
      >
        <Icon name="workflows" style="width: 13px; height: 13px; color: var(--textDim)" />
        <div class="wstasks-main">
          <div class="wstasks-label">{{ entry.title }}</div>
          <div class="wstasks-target">{{ entry.statusLabel }}</div>
        </div>
        <span class="wstasks-dot" :style="{ background: entry.color }" :title="entry.statusLabel" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Tasks tab — lists the real background Tasks spawned from THIS session (ADR 0055).
// A task carries its origin in `source = { type:'session', sessionId }`; we filter
// the live tasks store on the session's engineId, so status dots update over the
// store's `task.*` event subscription. Click a row to open the task. An empty
// session (or one with no engineId) shows the placeholder.
import { computed, onMounted } from 'vue'
import Icon from '~/components/Icon.vue'
import { useI18n } from '~/composables/useI18n'
import { useTasksStore, type TaskStatus } from '~/stores/tasks'
import { useSessionTaskLink } from '~/composables/useSessionTaskLink'
import type { Session } from '~/composables/useSessionsData'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const tasks = useTasksStore()
const { openTask } = useSessionTaskLink()

// Ensure the task list is loaded so links resolve even when the workspace panel is
// opened before the Tasks page was ever visited.
onMounted(() => {
  void tasks.loadTasks()
})

type Entry = { id: string; title: string; status: TaskStatus; statusLabel: string; color: string }

const colorOf = (status: TaskStatus): string => {
  if (status === 'running') return 'var(--amber)'
  if (status === 'failed') return 'var(--danger)'
  if (status === 'completed') return 'var(--add)'
  if (status === 'waiting_approval' || status === 'waiting_connection') return 'var(--amber)'
  return 'var(--textDim)'
}

const entries = computed<Entry[]>(() => {
  const eid = props.session.engineId
  if (!eid) return []
  const out: Entry[] = []
  for (const task of tasks.tasks) {
    if (task.source?.type !== 'session' || task.source.sessionId !== eid) continue
    out.push({
      id: task.id,
      title: task.title,
      status: task.status,
      statusLabel: t(`tasks.statusLabel.${task.status}`),
      color: colorOf(task.status),
    })
  }
  // Running tasks float to the top so an in-flight spawn is obvious.
  return out.sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running'))
})
</script>

<style scoped>
.wstasks {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
}
.wstasks-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wstasks-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgSubtle);
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition:
    border-color 0.12s ease,
    background 0.12s ease;
}
.wstasks-row:hover {
  border-color: var(--accentBorder);
  background: var(--bgHover);
}
.wstasks-main {
  min-width: 0;
  flex: 1;
}
.wstasks-label {
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wstasks-target {
  font-family: var(--code);
  font-size: 12px;
  color: var(--textDim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wstasks-dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
</style>
