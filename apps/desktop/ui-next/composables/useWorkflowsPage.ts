import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useNewTaskModal } from '~/composables/useNewTaskModal'
import { useProjects } from '~/composables/useProjects'
import { useToasts } from '~/composables/useToasts'
import {
  useWorkflowGen,
  type WorkflowAgent,
  type WorkflowDraft,
  type WorkflowSkill,
} from '~/composables/useWorkflowGen'
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
  const newTaskModal = useNewTaskModal()
  const { projects } = useProjects()
  const { toasts, pushToast, toastColor } = useToasts()
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

  // Valid gate.onFailTarget candidates (ADR 0056): the transitive ANCESTORS of
  // the selected node — re-running one re-flows the path back down to this gate.
  const gateTargets = computed<{ id: string; label: string }[]>(() => {
    const wf = workflow.value
    const sel = selectedNode.value
    if (!wf || !sel) return []
    const up = new Map<string, string[]>()
    for (const e of wf.edges) {
      const list = up.get(e.to) ?? []
      list.push(e.from)
      up.set(e.to, list)
    }
    const seen = new Set<string>()
    const queue = [...(up.get(sel.id) ?? [])]
    while (queue.length) {
      const id = queue.shift() as string
      if (seen.has(id)) continue
      seen.add(id)
      for (const f of up.get(id) ?? []) queue.push(f)
    }
    return wf.nodes
      .filter((n) => seen.has(n.id))
      .map((n) => {
        const agent = gen.agents.value.find((a) => a.id === n.agentId)
        return { id: n.id, label: agent?.name ? `${agent.name} (${n.id})` : n.id }
      })
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

  // --- run → New Task ------------------------------------------------------
  // Running a workflow opens the shared New Task modal pre-selected to this
  // workflow, so the user supplies the actual brief (title/description) and a
  // project before the task is created — a workflow alone carries no work item.
  // A project-tier workflow seeds its own project; a global one leaves it for the
  // user to pick. The modal (NewTaskModalHost in the default layout) owns creation.
  const onRun = () => {
    const wf = workflow.value
    if (!wf || wf.nodes.length === 0) return
    newTaskModal.openModal({
      workflowId: wf.id,
      title: wf.name,
      ...(wf.source === 'project' && wf.projectId ? { projectId: wf.projectId } : {}),
    })
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
    gateTargets,
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
    // run → New Task modal (shared host)
    onRun,
    // toasts
    toasts,
    toastColor,
  }
}
