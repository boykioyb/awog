<template>
  <!-- Teleport to body: a top-level floating stack that escapes any page stacking
       context. Bottom-right, above the page/panels but below full modals (z 95).
       Cố ý KHÔNG nằm trong OVERLAYS của useEmbeddedBrowser (chip ngồi thường trực). -->
  <Teleport to="body">
    <div
      v-if="entries.length"
      class="pointer-events-none fixed right-4 bottom-11.5 z-95 flex max-w-[min(20rem,calc(100vw-2rem))] flex-col items-end gap-2"
      :aria-label="t('minimize.title')"
    >
      <!-- Chip cả khối là một vùng bấm (khôi phục) và chứa nút dismiss lồng bên trong. -->
      <!-- raw-ok: Button shadcn không lồng được nút dismiss bên trong -->
      <button
        v-for="e in entries"
        :key="e.id"
        type="button"
        class="pointer-events-auto flex w-full cursor-pointer items-center gap-2 rounded-lg border bg-popover py-2 pr-2 pl-3 text-left text-popover-foreground shadow-md transition hover:-translate-y-px hover:border-input"
        :title="t('minimize.restore')"
        @click="restore(e)"
      >
        <span
          v-if="tone(e)"
          class="size-2 flex-none rounded-full"
          :class="TONE_CLASS[tone(e) || 'idle']"
        />
        <Icon :name="e.icon" class="size-4 flex-none text-muted-foreground" />
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-sm font-semibold">{{ titleOf(e) }}</span>
          <span v-if="sub(e)" class="truncate text-sm text-muted-foreground">{{ sub(e) }}</span>
        </span>
        <span
          class="grid size-6 flex-none place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          :title="t('minimize.dismiss')"
          role="button"
          tabindex="0"
          @click.stop="dismiss(e)"
          @keydown.enter.stop="dismiss(e)"
        >
          <Icon name="x" class="size-3.5" />
        </span>
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// The single, app-lifetime "minimize dock" (see docs/features/minimize-dock.md):
// a bottom-right stack of parked items (file previews, sessions, tasks, terminal).
// The store (useMinimizeDock) is pure data; this component owns restore dispatch +
// live-status derivation for session/task pills (a presentation concern kept in one
// always-mounted place). SoC: it reads feature stores only to render/route, never fs.
import { watch } from 'vue'
import { useMinimizeDock, type MinimizedEntry } from '~/composables/useMinimizeDock'
import { usePreview } from '~/composables/usePreview'
import { useGlobalTerminal } from '~/composables/useGlobalTerminal'
import { useTaskFocus } from '~/composables/useTaskFocus'
import { useSessionsStore } from '~/stores/sessions'
import { useTasksStore } from '~/stores/tasks'
import type { SessionStatus } from '~/composables/useSessionsData'
import type { TaskStatus } from '~/stores/tasks'

const { t } = useI18n()
const { entries, remove } = useMinimizeDock()
const preview = usePreview()
const term = useGlobalTerminal()
const { focusTask } = useTaskFocus()
const sessions = useSessionsStore()
const tasks = useTasksStore()

const sessionOf = (id: number) => sessions.sessions.find((s) => s.id === id)
const taskOf = (id: string) => tasks.taskById(id)

type Tone = 'idle' | 'running' | 'attention' | 'done' | 'error'

// Chấm trạng thái: đang chạy / cần chú ý thì nhấp nháy nhẹ.
const TONE_CLASS: Record<Tone, string> = {
  idle: 'bg-muted-foreground',
  running: 'bg-primary animate-pulse motion-reduce:animate-none',
  attention: 'bg-warning animate-pulse motion-reduce:animate-none',
  done: 'bg-success',
  error: 'bg-destructive',
}

function sessionTone(st: SessionStatus | undefined): Tone {
  if (st === 'streaming') return 'running'
  if (st === 'awaiting') return 'attention'
  if (st === 'error') return 'error'
  if (st === 'done') return 'done'
  return 'idle'
}
function taskTone(st: TaskStatus | undefined): Tone {
  if (st === 'running') return 'running'
  if (st === 'waiting_approval' || st === 'waiting_connection' || st === 'paused')
    return 'attention'
  if (st === 'failed') return 'error'
  if (st === 'completed') return 'done'
  return 'idle'
}

// Empty for preview/terminal — no live status dot.
function tone(e: MinimizedEntry): Tone | '' {
  if (e.kind === 'session') return sessionTone(sessionOf(e.sessionId)?.status)
  if (e.kind === 'task') return taskTone(taskOf(e.taskId)?.status)
  return ''
}

// Prefer the live title (session/task may have been renamed since minimize).
function titleOf(e: MinimizedEntry): string {
  if (e.kind === 'session') return sessionOf(e.sessionId)?.title || e.title
  if (e.kind === 'task') return taskOf(e.taskId)?.title || e.title
  return e.title
}

function sub(e: MinimizedEntry): string {
  const st = tone(e)
  if (e.kind === 'session' || e.kind === 'task') return st ? t(`minimize.status.${st}`) : ''
  return ''
}

function restore(e: MinimizedEntry): void {
  switch (e.kind) {
    case 'preview':
      preview.restore(e.ref, { view: e.view, scrollTop: e.scrollTop })
      break
    case 'terminal':
      term.open()
      break
    case 'session':
      sessions.setActive(e.sessionId)
      void navigateTo('/workbench')
      break
    case 'task':
      focusTask(e.taskId)
      void navigateTo('/tasks')
      break
  }
  remove(e.id)
}
function dismiss(e: MinimizedEntry): void {
  remove(e.id)
}

// Prune pills whose source session/task was deleted while parked (drop count
// changes → re-scan). Preview/terminal have no external source to vanish.
watch(
  () => [sessions.sessions.length, tasks.tasks.length],
  () => {
    for (const e of [...entries]) {
      if (e.kind === 'session' && !sessionOf(e.sessionId)) remove(e.id)
      else if (e.kind === 'task' && !taskOf(e.taskId)) remove(e.id)
    }
  },
)
</script>
