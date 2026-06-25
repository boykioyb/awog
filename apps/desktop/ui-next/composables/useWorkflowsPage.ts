import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useProjects } from '~/composables/useProjects'
import { useToasts } from '~/composables/useToasts'
import {
  useWorkflowGen,
  type WorkflowAgent,
  type WorkflowDraft,
  type WorkflowSkill,
} from '~/composables/useWorkflowGen'
import { useTasksStore } from '~/stores/tasks'
import {
  useWorkflowsStore,
  type Workflow,
  type WorkflowEdge,
  type WorkflowNode,
} from '~/stores/workflows'

// Page-controller for /workflows — owns selection, scope, CRUD, canvas mutation,
// chat-driven generation, and delete state so pages/workflows.vue stays a thin
// template. Mirrors the old UI pages/workflows/index.vue, ported to the ui-next
// surface (store + agent/skill rosters via useWorkflowGen).

export function useWorkflowsPage() {
  const store = useWorkflowsStore()
  const tasksStore = useTasksStore()
  const { projects } = useProjects()
  const { toasts, pushToast, toastColor } = useToasts()
  const { t } = useI18n()
  const gen = useWorkflowGen()

  const projectList = computed(() => projects.value.map((p) => ({ id: p.id, name: p.name })))

  // --- selection -----------------------------------------------------------
  const selectedWorkflowId = ref<string | null>(null)
  const selectedNodeId = ref<string | null>(null)

  const workflow = computed<Workflow | undefined>(() =>
    store.workflows.find((w) => w.id === selectedWorkflowId.value),
  )

  // --- hydrate -------------------------------------------------------------
  onMounted(async () => {
    const ids = projectList.value.map((p) => p.id)
    await store.loadWorkflows(ids)
    void gen.loadRosters(ids)
    if (!selectedWorkflowId.value) selectedWorkflowId.value = store.workflows[0]?.id ?? null
  })

  // Flush pending debounced persistence before navigating away so a drag/connect
  // right before leaving is never lost.
  onBeforeUnmount(() => store.flushPendingPersist())

  // --- scope filter --------------------------------------------------------
  // 'all' (view everything), 'global', or a projectId. Doubles as the target
  // scope for a newly-created workflow ('all' → global).
  const scopeFilter = ref<string>('all')

  const scopeOptions = computed(() => [
    { value: 'all', label: 'All' },
    { value: 'global', label: 'Global' },
    ...projectList.value.map((p) => ({ value: p.id, label: p.name })),
  ])

  const displayedWorkflows = computed<Workflow[]>(() => {
    const scope = scopeFilter.value
    if (scope === 'all') return store.workflows
    if (scope === 'global') {
      return store.workflows.filter((w) => (w.source ?? 'global') === 'global')
    }
    return store.workflows.filter((w) => w.source === 'project' && w.projectId === scope)
  })

  const selectWorkflow = (id: string) => {
    store.flushPendingPersist()
    selectedWorkflowId.value = id
    selectedNodeId.value = null
  }

  // Full rosters — the canvas uses these to RESOLVE node agent/skill refs for
  // rendering (a node's agent must always resolve, even if the palette below
  // would hide it). The scoped subsets (paletteAgents / availableSkills) only
  // gate which entries a user may ADD.
  const allAgents = computed<WorkflowAgent[]>(() => gen.agents.value)
  const allSkills = computed<WorkflowSkill[]>(() => gen.skills.value)

  // --- palette agents (scoped to the SELECTED workflow's tier) -------------
  // project workflow → portable (global) agents + that project's agents;
  // global workflow (or none) → only portable agents, so a shared workflow never
  // references a project agent that won't exist when run elsewhere.
  const isProjectAgent = (a: WorkflowAgent): boolean => a.source === 'project'
  const paletteAgents = computed<WorkflowAgent[]>(() => {
    const wf = workflow.value
    if (wf?.source === 'project' && wf.projectId) {
      return gen.agents.value.filter((a) => !isProjectAgent(a) || a.projectId === wf.projectId)
    }
    return gen.agents.value.filter((a) => !isProjectAgent(a))
  })

  // --- selected node + inspector data --------------------------------------
  const selectedNode = computed<WorkflowNode | undefined>(() =>
    workflow.value?.nodes.find((n) => n.id === selectedNodeId.value),
  )
  const selectedAgent = computed<WorkflowAgent | undefined>(() => {
    const n = selectedNode.value
    return n ? gen.agents.value.find((a) => a.id === n.agentId) : undefined
  })
  const selectedSkill = computed<WorkflowSkill | undefined>(() => {
    const n = selectedNode.value
    return n ? gen.skills.value.find((s) => s.id === n.skillId) : undefined
  })

  // Skills offered in the node picker — scoped to the workflow's tier (preserve
  // per-project skill scope; a global workflow only sees global skills).
  const availableSkills = computed<WorkflowSkill[]>(() => {
    const wf = workflow.value
    if (wf?.source === 'project' && wf.projectId) {
      return gen.skills.value.filter((s) => s.source !== 'project' || s.projectId === wf.projectId)
    }
    return gen.skills.value.filter((s) => s.source !== 'project')
  })

  // --- canvas mutations ----------------------------------------------------
  const onNodesUpdate = (nodes: WorkflowNode[]) => {
    if (!workflow.value) return
    store.updateWorkflowNodes(workflow.value.id, nodes)
  }
  const onEdgesUpdate = (edges: WorkflowEdge[]) => {
    if (!workflow.value) return
    store.updateWorkflowEdges(workflow.value.id, edges)
  }
  const onSelectNode = (id: string | null) => {
    selectedNodeId.value = id
  }
  const onInspectorUpdate = (updated: WorkflowNode) => {
    if (!workflow.value) return
    onNodesUpdate(workflow.value.nodes.map((n) => (n.id === updated.id ? updated : n)))
  }

  // --- create (chat-driven) ------------------------------------------------
  const creatorOpen = ref(false)
  const openCreator = () => {
    creatorOpen.value = true
  }
  const closeCreator = () => {
    creatorOpen.value = false
  }
  const onCreatorSave = (draft: WorkflowDraft, scope: string) => {
    const wf = store.createWorkflow(draft.name, scope)
    store.saveWorkflow({
      ...wf,
      description: draft.description,
      nodes: draft.nodes,
      edges: draft.edges,
    })
    scopeFilter.value = scope
    selectedWorkflowId.value = wf.id
    selectedNodeId.value = null
    creatorOpen.value = false
    pushToast(`Created "${draft.name}"`, 'success')
  }

  // --- rename --------------------------------------------------------------
  const renamingId = ref<string | null>(null)
  const renameValue = ref('')
  const startRename = (id: string, current: string) => {
    renamingId.value = id
    renameValue.value = current
  }
  const commitRename = () => {
    const id = renamingId.value
    if (!id) return
    const trimmed = renameValue.value.trim()
    const wf = store.workflowById(id)
    if (trimmed && wf && trimmed !== wf.name) store.renameWorkflow(id, trimmed)
    renamingId.value = null
  }
  const cancelRename = () => {
    renamingId.value = null
  }

  // --- delete --------------------------------------------------------------
  const pendingDeleteId = ref<string | null>(null)
  const askDelete = (id: string) => {
    pendingDeleteId.value = id
  }
  const cancelDelete = () => {
    pendingDeleteId.value = null
  }
  const pendingDeleteName = computed(
    () => store.workflowById(pendingDeleteId.value ?? '')?.name ?? '',
  )
  const confirmDelete = () => {
    const id = pendingDeleteId.value
    if (!id) return
    const name = pendingDeleteName.value
    store.deleteWorkflow(id)
    if (selectedWorkflowId.value === id) {
      selectedWorkflowId.value = store.workflows[0]?.id ?? null
      selectedNodeId.value = null
    }
    pendingDeleteId.value = null
    pushToast(`Deleted "${name}"`, 'success')
  }

  // --- run → create Task ---------------------------------------------------
  // Running a workflow hands off to the Tasks feature: snapshot the workflow into
  // a Task (the engine resolves the authoritative snapshot from workflowId; the
  // slice here is for the optimistic detail view) then navigate to /tasks.
  //
  // A task always needs a project. A project-tier workflow supplies its own; a
  // global workflow has none, so we surface a minimal project picker (preselecting
  // nothing — the user chooses). When zero projects exist there is nothing to run
  // against, so we toast and bail.
  const projectPickerOpen = ref(false)
  const runProjectId = ref('')
  const runProjectOptions = computed(() =>
    projectList.value.map((p) => ({ value: p.id, label: p.name })),
  )

  // Build the engine-shaped snapshot slice (id/name + node/edge refs) used for the
  // optimistic Task detail. agentName is resolved from the loaded roster so the
  // pipeline labels render before the engine returns its own snapshot.
  const buildSnapshot = (wf: Workflow) => ({
    id: wf.id,
    name: wf.name,
    nodes: wf.nodes.map((n) => {
      const agentName = allAgents.value.find((a) => a.id === n.agentId)?.name
      return {
        id: n.id,
        agentId: n.agentId,
        ...(agentName ? { agentName } : {}),
        skillId: n.skillId,
        approval: n.approval,
      }
    }),
    edges: wf.edges.map((e) => ({ from: e.from, to: e.to })),
  })

  // Create the task for `wf` against `projectId`, then jump to Tasks.
  const launchTask = (wf: Workflow, projectId: string) => {
    const task = tasksStore.createTask(
      {
        title: wf.name,
        description: wf.description,
        source: { type: 'manual' },
        workflowId: wf.id,
        projectId,
      },
      buildSnapshot(wf),
    )
    pushToast(t('workflow.run.created', { title: task.title }), 'success')
    void navigateTo('/tasks')
  }

  const onRun = () => {
    const wf = workflow.value
    if (!wf || wf.nodes.length === 0) return
    // Project-tier workflow → run against its own project directly.
    if (wf.source === 'project' && wf.projectId) {
      launchTask(wf, wf.projectId)
      return
    }
    // Global workflow → needs a project chosen by the user.
    if (projectList.value.length === 0) {
      pushToast(t('workflow.run.noProject'), 'error')
      return
    }
    runProjectId.value = ''
    projectPickerOpen.value = true
  }

  const cancelProjectPicker = () => {
    projectPickerOpen.value = false
  }
  const confirmProjectPicker = () => {
    const wf = workflow.value
    const projectId = runProjectId.value
    if (!wf || !projectId) return
    projectPickerOpen.value = false
    launchTask(wf, projectId)
  }

  return {
    // rosters / data
    projectList,
    accountId: gen.accountId,
    generate: gen.generate,
    // scope
    scopeFilter,
    scopeOptions,
    displayedWorkflows,
    // selection
    selectedWorkflowId,
    selectedNodeId,
    workflow,
    selectWorkflow,
    // rosters (canvas node lookup) + palette + inspector
    allAgents,
    allSkills,
    paletteAgents,
    selectedNode,
    selectedAgent,
    selectedSkill,
    availableSkills,
    // canvas
    onNodesUpdate,
    onEdgesUpdate,
    onSelectNode,
    onInspectorUpdate,
    // create
    creatorOpen,
    openCreator,
    closeCreator,
    onCreatorSave,
    // rename
    renamingId,
    renameValue,
    startRename,
    commitRename,
    cancelRename,
    // delete
    pendingDeleteId,
    askDelete,
    cancelDelete,
    pendingDeleteName,
    confirmDelete,
    // run → task
    onRun,
    projectPickerOpen,
    runProjectId,
    runProjectOptions,
    cancelProjectPicker,
    confirmProjectPicker,
    // toasts
    toasts,
    toastColor,
  }
}
