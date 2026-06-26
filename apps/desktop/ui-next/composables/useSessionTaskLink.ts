// Cross-navigation between Sessions and Tasks (ADR 0055). Both directions of the
// Session ↔ Task link resolve through here so the page-switch + store-select dance
// lives in one place: Task → origin/discussion session, Session → the task it
// discusses, and the WorkspaceTasks rows → their task. Stores are loaded lazily so
// it works regardless of which page the user arrived from.
import { useSessionsStore } from '~/stores/sessions'
import { useTasksStore } from '~/stores/tasks'

export function useSessionTaskLink() {
  const sessions = useSessionsStore()
  const tasks = useTasksStore()

  // Open a session by its sidecar engineId. Returns false when no such session
  // exists (deleted) so the caller can surface a "session not found" hint.
  async function openSession(engineId: string): Promise<boolean> {
    const ok = await sessions.openByEngineId(engineId)
    if (ok) await navigateTo('/sessions')
    return ok
  }

  // Open a task by id. Ensures the task list is loaded (the user may arrive from a
  // page that never fetched tasks) before selecting + navigating.
  async function openTask(taskId: string): Promise<void> {
    if (!tasks.taskById(taskId)) await tasks.loadTasks()
    tasks.selectTask(taskId)
    await navigateTo('/tasks')
  }

  // Create a fresh session bound to a task (aboutTaskId) and navigate to it. The
  // sidecar injects the task's output + trace as <linked_task> context each turn,
  // so the user can ask the agent about the task's results.
  async function discussInSession(taskId: string, projectId: string, title: string): Promise<void> {
    sessions.createForTask(taskId, projectId, title)
    await navigateTo('/sessions')
  }

  return { openSession, openTask, discussInSession }
}
