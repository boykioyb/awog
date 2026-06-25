import { computed, onMounted, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useNewTaskData, type WorkflowOption } from '~/composables/useNewTaskData'
import { useToasts } from '~/composables/useToasts'
import { useTasksStore, type CreateTaskInput, type Task } from '~/stores/tasks'

// Page-controller for /tasks — owns selection, the New Task modal flow, the
// delete-confirm flow, and the per-phase lifecycle handlers so pages/tasks.vue
// stays a thin template. Mirrors useSkillsPage (the reference page-controller),
// adapted to the engine-shaped Tasks store. State + IPC live here; the page only
// binds.

export function useTasksPage() {
  const store = useTasksStore()
  const { t } = useI18n()
  const { toasts, pushToast, toastColor } = useToasts()
  const newTaskData = useNewTaskData()

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
  const newOpen = ref(false)
  const openNew = () => {
    newOpen.value = true
    void newTaskData.load()
  }
  const closeNew = () => {
    newOpen.value = false
  }
  // Emitted by NewTaskModal once the user confirms (and any dirty-workspace gate
  // resolved). Resolves the chosen workflow's snapshot to forward to the store so
  // the optimistic detail renders the pipeline immediately.
  const onCreate = (data: CreateTaskInput) => {
    const wf: WorkflowOption | undefined = newTaskData.workflows.value.find(
      (w) => w.id === data.workflowId,
    )
    const snapshot = wf ? { id: wf.id, name: wf.name, nodes: wf.nodes, edges: wf.edges } : undefined
    const task = store.createTask(data, snapshot)
    newOpen.value = false
    pushToast(t('tasks.toast.created', { title: task.title }), 'success')
  }

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
    // new task modal
    newOpen,
    openNew,
    closeNew,
    onCreate,
    newTaskData,
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
