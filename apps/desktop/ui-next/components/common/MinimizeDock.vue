<template>
  <!-- Teleport to body: a top-level floating stack that escapes any page stacking
       context. Bottom-right, above the page/panels but below full modals (z 95). -->
  <Teleport to="body">
    <div v-if="entries.length" class="mdock" :aria-label="t('minimize.title')">
      <button
        v-for="e in entries"
        :key="e.id"
        class="mdchip"
        :title="t('minimize.restore')"
        @click="restore(e)"
      >
        <span v-if="tone(e)" class="mddot" :class="tone(e)" />
        <Icon :name="e.icon" class="mdicon" />
        <span class="mdtext">
          <span class="mdtitle">{{ titleOf(e) }}</span>
          <span v-if="sub(e)" class="mdsub">{{ sub(e) }}</span>
        </span>
        <span
          class="mdx"
          :title="t('minimize.dismiss')"
          role="button"
          tabindex="0"
          @click.stop="dismiss(e)"
          @keydown.enter.stop="dismiss(e)"
        >
          <Icon name="x" class="mdxi" />
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
      void navigateTo('/sessions')
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

<style scoped>
.mdock {
  position: fixed;
  right: 16px;
  bottom: 46px;
  z-index: 95;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  max-width: min(320px, calc(100vw - 32px));
  pointer-events: none;
}
.mdchip {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 8px 8px 11px;
  border-radius: 10px;
  background: var(--bgEl);
  border: 1px solid var(--border);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  color: var(--text);
  cursor: pointer;
  text-align: left;
  transition:
    transform 0.12s ease,
    border-color 0.12s ease,
    box-shadow 0.12s ease;
}
.mdchip:hover {
  transform: translateY(-1px);
  border-color: var(--borderStrong);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.45);
}
.mddot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--textDim);
}
.mddot.running {
  background: var(--accent);
  animation: mdpulse 1.4s ease-in-out infinite;
}
.mddot.attention {
  background: var(--amber);
  animation: mdpulse 1.4s ease-in-out infinite;
}
.mddot.done {
  background: var(--green);
}
.mddot.error {
  background: var(--danger);
}
@keyframes mdpulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
.mdicon {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
  color: var(--textDim);
}
.mdtext {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
  line-height: 1.25;
}
.mdtitle {
  font-family: var(--code);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mdsub {
  font-size: 12px;
  color: var(--textFaint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mdx {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  color: var(--textDim);
}
.mdx:hover {
  background: var(--bgHover);
  color: var(--text);
}
.mdxi {
  width: 13px;
  height: 13px;
}
</style>
