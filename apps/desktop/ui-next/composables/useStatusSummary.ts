import { computed } from 'vue'
import { useSessionsStore } from '~/stores/sessions'
import { useTasksStore } from '~/stores/tasks'
import type { AwogTrayCommand } from '~/types/awog-bridge'

// Shared plumbing for the two glanceable status surfaces — the system tray
// indicator (useTrayStatus) and the desktop pet (usePetStatus). Both answer the
// same question ("is anything running / waiting for me / finished?") and both route
// a clicked item back into the app, so the counting rule and the routing live here
// once instead of drifting apart in two composables.
//
// MAIN WINDOW ONLY: the counts read live store state (a `streaming` status is never
// persisted), and the routing navigates the main app.

export function useStatusCounts() {
  const sessions = useSessionsStore()
  const tasks = useTasksStore()

  const running = computed(
    () =>
      tasks.runningTasks.length + sessions.sessions.filter((s) => s.status === 'streaming').length,
  )
  const attention = computed(
    () =>
      tasks.awaitingTasks.length + sessions.sessions.filter((s) => s.status === 'awaiting').length,
  )
  // Finished-but-unread sessions: without these the surface goes blank the moment
  // work completes, which is exactly when the user most wants to be told.
  const unread = computed(() => sessions.sessions.filter((s) => s.unread).length)

  return { running, attention, unread }
}

export function useStatusRouting() {
  const sessions = useSessionsStore()
  const tasks = useTasksStore()
  const { openActivity } = useActivityModal()

  // Open what the tray popover / pet was pointing at. Sessions resolve by the STABLE
  // engine id — those surfaces are separate renderers with their own numeric client
  // ids, which never match this store's.
  function openTarget(cmd: AwogTrayCommand): void {
    if (cmd.kind === 'activity') {
      openActivity()
      return
    }
    if (cmd.kind === 'session') {
      // openByEngineId hydrates first, so this works before Sessions has ever loaded.
      navigateTo('/sessions')
      void sessions.openByEngineId(cmd.engineId)
      return
    }
    tasks.selectTask(cmd.id)
    navigateTo('/tasks')
  }

  return { openTarget }
}
