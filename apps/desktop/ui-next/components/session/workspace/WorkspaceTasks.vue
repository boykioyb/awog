<template>
  <div class="h-full min-h-0 overflow-y-auto">
    <div v-if="!entries.length && !shellEntries.length" class="empty" style="padding: 30px">
      <div class="et">{{ t('sessions.workspace.tasks.placeholder') }}</div>
    </div>

    <div v-else class="flex flex-col gap-3 p-3">
      <!-- Background shells của session — Bash(run_in_background)/CLI bg jobs.
           Không click mở được (không phải task); xem output ở chip trên composer. -->
      <div v-if="shellEntries.length" class="flex flex-col gap-1.5">
        <div class="text-xs font-medium text-dim">{{ t('sessions.workspace.tasks.bgTitle') }}</div>
        <div
          v-for="sh in shellEntries"
          :key="sh.shellId"
          class="flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2"
          :title="sh.command"
        >
          <TerminalSquare class="size-3.5 shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <div class="truncate font-mono text-sm text-foreground">{{ sh.short }}</div>
            <div class="truncate text-xs text-muted-foreground">{{ sh.label }}</div>
          </div>
          <span class="size-2 shrink-0 rounded-full" :class="sh.color" :title="sh.label" />
        </div>
      </div>

      <div v-if="entries.length" class="flex flex-col gap-1.5">
        <div v-if="shellEntries.length" class="text-xs font-medium text-dim">
          {{ t('sessions.workspace.tasks.taskTitle') }}
        </div>
        <Button
          v-for="entry in entries"
          :key="entry.id"
          variant="outline"
          class="h-auto p-0 flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
          @click="openTask(entry.id)"
        >
          <Workflow class="size-3.5 shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium text-foreground">{{ entry.title }}</div>
            <div class="truncate text-xs text-muted-foreground">{{ entry.statusLabel }}</div>
          </div>
          <span
            class="size-2 shrink-0 rounded-full"
            :class="entry.color"
            :title="entry.statusLabel"
          />
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Tasks tab — lists the real background Tasks spawned from THIS session (ADR 0055).
// A task carries its origin in `source = { type:'session', sessionId }`; we filter
// the live tasks store on the session's engineId, so status dots update over the
// store's `task.*` event subscription. Click a row to open the task. An empty
// session (or one with no engineId) shows the placeholder.
import { TerminalSquare, Workflow } from 'lucide-vue-next'
import { useTasksStore, type TaskStatus } from '~/stores/tasks'
import { useSessionTaskLink } from '~/composables/useSessionTaskLink'
import { useSessionsStore } from '~/stores/sessions'
import type { Session } from '~/composables/useSessionsData'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const tasks = useTasksStore()
const sessions = useSessionsStore()
const { openTask } = useSessionTaskLink()

// Ensure the task list is loaded so links resolve even when the workspace panel is
// opened before the Tasks page was ever visited.
onMounted(() => {
  void tasks.loadTasks()
})

type Entry = { id: string; title: string; status: TaskStatus; statusLabel: string; color: string }

const colorOf = (status: TaskStatus): string => {
  if (status === 'running') return 'bg-warning'
  if (status === 'failed') return 'bg-destructive'
  if (status === 'completed') return 'bg-success'
  if (status === 'waiting_approval' || status === 'waiting_connection') return 'bg-warning'
  return 'bg-muted-foreground'
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

// Background shells — `Bash(run_in_background)` trên Pi / CLI bg jobs trên Claude
// SDK (cùng registry sessions.bgShells). Trạng thái cập nhật live theo event
// session.background-*; exitCode 0 → ok, !=0 → fail, đang chạy → warn.
type ShellEntry = { shellId: string; command: string; short: string; label: string; color: string }
const shellEntries = computed<ShellEntry[]>(() => {
  const eid = props.session.engineId
  if (!eid) return []
  const out: ShellEntry[] = []
  for (const sh of sessions.bgShellsFor(eid)) {
    const failed = sh.status !== 'running' && (sh.exitCode ?? 1) !== 0
    out.push({
      shellId: sh.shellId,
      command: sh.command,
      short: sh.command.length > 64 ? sh.command.slice(0, 61) + '…' : sh.command,
      label:
        sh.status === 'running'
          ? t('sessions.bg.summary.running', { n: 1 }).replace(/^1 /, '')
          : failed
            ? t('sessions.bg.summary.failed', { n: 1 }).replace(/^1 /, '') +
              (sh.exitCode != null ? ` (${sh.exitCode})` : '')
            : t('sessions.bg.summary.done', { n: 1 }).replace(/^1 /, ''),
      color: sh.status === 'running' ? 'bg-warning' : failed ? 'bg-destructive' : 'bg-success',
    })
  }
  const rank = (c: string) => (c === 'bg-warning' ? 0 : c === 'bg-destructive' ? 1 : 2)
  return out.sort((a, b) => rank(a.color) - rank(b.color))
})
</script>
