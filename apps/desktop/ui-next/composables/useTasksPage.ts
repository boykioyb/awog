import { computed, onMounted, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useNewTaskModal } from '~/composables/useNewTaskModal'
import { useToasts } from '~/composables/useToasts'
import { useTasksStore, type Task } from '~/stores/tasks'

// Page-controller for /tasks — owns selection, the New Task modal flow, the
// delete-confirm flow, and the per-phase lifecycle handlers so pages/tasks.vue
// stays a thin template. Mirrors useSkillsPage (the reference page-controller),
// adapted to the engine-shaped Tasks store. State + IPC live here; the page only
// binds.

export function useTasksPage() {
  const store = useTasksStore()
  const { t } = useI18n()
  const { toasts, pushToast, toastColor } = useToasts()
  const { openModal } = useNewTaskModal()

  // ── selection ───────────────────────────────────────────────────────────────
  // The store owns selectedTaskId; the page selects via setSelected.
  const tasks = computed<Task[]>(() => store.tasks)
  const selectedTask = computed<Task | null>(() => store.selectedTask ?? store.tasks[0] ?? null)
  const setSelected = (task: Task) => store.selectTask(task.id)

  // ── hydrate ───────────────────────────────────────────────────────────────
  onMounted(() => {
    void store.loadTasks()
  })

  // ── new task modal ───────────────────────────────────────────────────────────
  // Creation now lives in the shared NewTaskModalHost (mounted in the layout) so the
  // same modal serves both the Tasks page and the session "Run as task" action.
  const openNew = () => openModal()

  // ── lifecycle handlers (forwarded from TaskDetail) ───────────────────────────
  const approve = (taskId: string, nodeId: string) => {
    store.approvePhase(taskId, nodeId)
    pushToast(t('tasks.toast.approved'), 'success')
  }
  const rerun = (taskId: string, nodeId: string, instruction: string) => {
    store.rerunPhase(taskId, nodeId, instruction)
    pushToast(t('tasks.toast.rerun'), 'info')
  }
  const discuss = (taskId: string, nodeId: string, runVersion: number, text: string) => {
    store.discussPhase(taskId, nodeId, runVersion, text)
  }
  const cancel = (taskId: string) => {
    store.cancelTask(taskId)
    pushToast(t('tasks.toast.canceled'), 'info')
  }
  const pause = (taskId: string) => store.pauseTask(taskId)
  const resume = (taskId: string) => store.resumeTask(taskId)

  // ── delete ───────────────────────────────────────────────────────────────────
  const pendingDelete = ref<Task | null>(null)
  const askDelete = (task: Task) => {
    pendingDelete.value = task
  }
  const cancelDelete = () => {
    pendingDelete.value = null
  }
  const deleteDescription = computed(() => {
    const task = pendingDelete.value
    if (!task) return ''
    return t('tasks.delete.desc', { title: task.title })
  })
  const confirmDelete = () => {
    const task = pendingDelete.value
    if (!task) return
    pendingDelete.value = null
    store.deleteTask(task.id)
    pushToast(t('tasks.toast.deleted'), 'success')
  }

  return {
    // store-backed
    tasks,
    selectedTask,
    setSelected,
    progressOf: store.progressOf,
    phaseOrder: store.phaseOrder,
    nodeFor: store.nodeFor,
    // new task modal (opens the shared host)
    openNew,
    // lifecycle
    approve,
    rerun,
    discuss,
    cancel,
    pause,
    resume,
    // delete
    pendingDelete,
    askDelete,
    cancelDelete,
    deleteDescription,
    confirmDelete,
    // toasts
    toasts,
    toastColor,
  }
}
