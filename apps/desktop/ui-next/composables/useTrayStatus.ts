import { computed, onScopeDispose, watch } from 'vue'
import { useSessionsStore } from '~/stores/sessions'
import { useTasksStore } from '~/stores/tasks'
import type { AwogTrayModel } from '~/types/awog-bridge'

// ── Tray indicator + command routing (docs/features/system-tray-status.md) ───
// The STYLED tray view lives in its own popover window (pages/tray-popover.vue).
// This composable runs in the MAIN window and does two small things:
//   1. push the glanceable indicator (running count → macOS title, tooltip)
//   2. route tray/popover item clicks (tray:command) into the main app
// Call once globally (in the layout). No-op when the bridge is absent (browser dev).

export function useTrayStatus() {
  const bridge = typeof window !== 'undefined' ? window.awog : undefined
  if (!bridge?.sendTrayUpdate) return // browser-dev / no tray → nothing to drive

  const { t } = useI18n()
  const sessions = useSessionsStore()
  const tasks = useTasksStore()
  const { openActivity } = useActivityModal()

  // Ensure the stores have data even if the user never opened Sessions/Tasks.
  void sessions.hydrate?.()
  void tasks.loadTasks()

  const model = computed<AwogTrayModel>(() => {
    const running =
      tasks.runningTasks.length + sessions.sessions.filter((s) => s.status === 'streaming').length
    const attention =
      tasks.awaitingTasks.length + sessions.sessions.filter((s) => s.status === 'awaiting').length
    return {
      macTitle: running > 0 ? `${running}▶` : '',
      tooltip: running || attention ? t('tray.tooltip.busy', { running, attention }) : 'AWOG',
    }
  })

  let pushTimer: ReturnType<typeof setTimeout> | null = null
  const stopModel = watch(
    model,
    (m) => {
      if (pushTimer) clearTimeout(pushTimer)
      pushTimer = setTimeout(() => bridge.sendTrayUpdate({ ...m }), 300)
    },
    { immediate: true },
  )

  // Route clicks coming from the tray menu / popover into the main app.
  const offCommand = bridge.onTrayCommand?.((cmd) => {
    if (cmd.kind === 'activity') {
      openActivity()
    } else if (cmd.kind === 'session') {
      sessions.setActive(cmd.id)
      navigateTo('/sessions')
    } else if (cmd.kind === 'task') {
      tasks.selectTask(cmd.id)
      navigateTo('/tasks')
    }
  })

  onScopeDispose(() => {
    if (pushTimer) clearTimeout(pushTimer)
    stopModel()
    offCommand?.()
  })
}
