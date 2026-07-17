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
    // Finished-but-unread sessions: surfaced so the tray flags "go read it" even
    // after nothing is actively running (the gap the user hit — a done session
    // left the menu bar blank). Drives a dot in the macOS title + the tooltip.
    const unread = sessions.sessions.filter((s) => s.unread).length
    return {
      macTitle: running > 0 ? `${running}▶` : attention + unread > 0 ? '●' : '',
      tooltip:
        running || attention || unread
          ? t('tray.tooltip.busy', { running, attention, unread })
          : 'AWOG',
      // Dock badge count (Telegram-style) — the finished-but-unread sessions.
      unreadCount: unread,
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
      // Resolve by the stable engine id — the popover sent the sidecar id, not its
      // own renderer's numeric client id (which never matches this store).
      // openByEngineId hydrates first, so it works even before Sessions has loaded.
      navigateTo('/sessions')
      void sessions.openByEngineId(cmd.engineId)
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
