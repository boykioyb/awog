import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'

// Workflows store — dual-path live (2-tier DAG, ADR 0024). When the Electron
// bridge is available `loadWorkflows()` scans the global tier (~/.awog/workflows)
// + every passed project tier ({project}/.awog/workflows); browser-dev seeds a
// small mock so the canvas is browsable. Canvas mutations are optimistic + a
// debounced `workflows.upsert` coalesces rapid drag/connect bursts (mirrors the
// old UI stores/workflows.ts). Sidecar emits NO `workflows.fs-changed` event, so
// there is no fs-watch subscription here (unlike skills/agents).
//
// Mirrors the reference library store (stores/skills.ts): inline slice types,
// readonly-state + named async actions, mock seed gated on `!sc.available`.

export type WorkflowSource = 'global' | 'project'

// Quality-gate loop-back directive on a node (ADR 0056). onFailTarget is a
// transitive ancestor; on verdict `fail` the engine reruns it up to
// maxIterations, then escalates to a human.
export type NodeGate = {
  onFailTarget: string
  maxIterations: number
  auto: boolean
}

// Agent identity tuple carried on a node (ADR 0024 D-11) so the engine resolves
// the right agent across tiers without a lookup-by-id guess.
export type WorkflowNode = {
  id: string
  agentId: string
  agentSource?: WorkflowSource
  agentProjectId?: string
  // Skill resolved PER node project scope (the task's project + the node's agent
  // project) — NOT the union of every project's skills. Empty = no skill.
  skillId: string
  x: number
  y: number
  outputs: string[]
  approval: boolean
  // Gate config (ADR 0056). Absent = ordinary node.
  gate?: NodeGate
}

export type WorkflowEdge = {
  from: string
  to: string
}

// A 2-tier DAG. `source`/`projectId` are tags derived from the on-disk location
// (not persisted inside the JSON), exactly like Skills.
export type Workflow = {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  source?: WorkflowSource
  projectId?: string
}

type WorkflowsListResponse = { workflows: Workflow[] }

// Raw DAG the model returns from workflows.generate (agentId/skillId refs only,
// no x/y geometry — the caller lays it out + resolves agent tiers).
export type GenNode = {
  id: string
  agentId: string
  skillId: string
  outputs: string[]
  approval: boolean
}
export type GeneratedWorkflow = {
  name: string
  description: string
  nodes: GenNode[]
  edges: { from: string; to: string }[]
}
type GenerateResponse = { workflow: GeneratedWorkflow }

// Debounce canvas-driven persistence: drag-stop / connect / disconnect fire in
// bursts. 500ms matches the sidecar fs-watcher debounce.
const PERSIST_DEBOUNCE_MS = 500

function mockWorkflows(): Workflow[] {
  return [
    {
      id: 'wf-feature-pipeline',
      name: 'Feature Pipeline',
      description: 'Brief → ADR → implement → audit → verify',
      source: 'global',
      nodes: [
        {
          id: 'n1',
          agentId: 'tech-lead',
          agentSource: 'global',
          skillId: 'write-adr',
          x: 80,
          y: 60,
          outputs: ['adr.md'],
          approval: true,
        },
        {
          id: 'n2',
          agentId: 'developer',
          agentSource: 'global',
          skillId: 'implement-feature',
          x: 360,
          y: 60,
          outputs: ['source.diff'],
          approval: false,
        },
        {
          id: 'n3',
          agentId: 'infosec',
          agentSource: 'global',
          skillId: 'security-audit',
          x: 640,
          y: 60,
          outputs: ['findings.md'],
          approval: false,
        },
      ],
      edges: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
      ],
    },
  ]
}

export const useWorkflowsStore = defineStore('workflows', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const workflows = ref<Workflow[]>(sc.available ? [] : mockWorkflows())
  const loaded = ref(false)

  // Per-workflow debounce timers for canvas persistence.
  const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const workflowById = (id: string): Workflow | undefined =>
    workflows.value.find((w) => w.id === id)

  // Fire-and-forget persistence. UI state stays optimistic — sidecar errors are
  // logged but never block the user.
  const pushUpsert = (workflow: Workflow, mode: 'create' | 'update'): void => {
    if (!available.value) return
    sc.request('workflows.upsert', { workflow, mode }).catch((err) => {
      console.warn('[workflows] upsert failed:', err)
    })
  }

  // Scan the global tier + every passed project tier. Default scope is global
  // only (the page passes its project roster).
  async function loadWorkflows(projectIds?: string[]): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    try {
      // Pass an explicit object (never `undefined`) — the IPC boundary maps
      // undefined params → null and the sidecar zod schema rejects null.
      const ids = projectIds ?? []
      const params = ids.length > 0 ? { projectIds: ids } : {}
      const res = await sc.request<WorkflowsListResponse>('workflows.list', params)
      workflows.value = Array.isArray(res.workflows) ? res.workflows : []
    } catch (err) {
      console.warn('[workflows] loadWorkflows failed', err)
    } finally {
      loaded.value = true
    }
  }

  // scope: 'global' (default, shared) or a projectId (lives in that repo).
  function createWorkflow(name: string, scope: WorkflowSource | string = 'global'): Workflow {
    const isProject = scope !== 'global'
    const wf: Workflow = {
      id: `wf-${Date.now()}`,
      name,
      description: 'New workflow',
      nodes: [],
      edges: [],
      source: isProject ? 'project' : 'global',
    }
    if (isProject) wf.projectId = scope
    workflows.value = [wf, ...workflows.value]
    pushUpsert(wf, 'create')
    return wf
  }

  // Create-or-update. Used by the chat creator to persist a generated draft.
  function saveWorkflow(workflow: Workflow): void {
    const existing = workflowById(workflow.id)
    if (existing) Object.assign(existing, workflow)
    else workflows.value = [workflow, ...workflows.value]
    pushUpsert(workflow, existing ? 'update' : 'create')
  }

  function renameWorkflow(id: string, name: string): void {
    const wf = workflowById(id)
    if (!wf) return
    wf.name = name
    pushUpsert(wf, 'update')
  }

  function deleteWorkflow(id: string): void {
    const wf = workflowById(id)
    workflows.value = workflows.value.filter((w) => w.id !== id)
    const timer = persistTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      persistTimers.delete(id)
    }
    if (!available.value) return
    sc.request('workflows.delete', {
      id,
      source: wf?.source ?? 'global',
      ...(wf?.projectId ? { projectId: wf.projectId } : {}),
    }).catch((err) => {
      console.warn('[workflows] delete failed:', err)
    })
  }

  function schedulePersist(workflowId: string): void {
    const prev = persistTimers.get(workflowId)
    if (prev) clearTimeout(prev)
    persistTimers.set(
      workflowId,
      setTimeout(() => {
        persistTimers.delete(workflowId)
        const wf = workflowById(workflowId)
        if (wf) pushUpsert(wf, 'update')
      }, PERSIST_DEBOUNCE_MS),
    )
  }

  // Canvas mutations: mutate local state immediately (instant UI) then schedule a
  // debounced upsert so rapid drag/connect bursts collapse into one RPC.
  function updateWorkflowNodes(workflowId: string, nodes: WorkflowNode[]): void {
    const wf = workflowById(workflowId)
    if (!wf) return
    wf.nodes = nodes
    schedulePersist(workflowId)
  }

  function updateWorkflowEdges(workflowId: string, edges: WorkflowEdge[]): void {
    const wf = workflowById(workflowId)
    if (!wf) return
    wf.edges = edges
    schedulePersist(workflowId)
  }

  // Flush every pending debounce immediately — call on page unmount / before
  // switching workflow so an edit right before navigation is never lost.
  function flushPendingPersist(): void {
    persistTimers.forEach((timer, id) => {
      clearTimeout(timer)
      const wf = workflowById(id)
      if (wf) pushUpsert(wf, 'update')
    })
    persistTimers.clear()
  }

  // One-shot LLM draft from a natural-language prompt (workflows.generate). The
  // caller supplies the scoped agents/skills the model may wire; node x/y layout
  // + agent source/projectId resolution happen on the caller side (composable
  // useWorkflowGen). Returns the raw generated DAG (agentId/skillId refs, no
  // geometry) — throws on failure so the caller can fall back to a local mock.
  async function generateWorkflow(params: {
    prompt: string
    accountId: string
    availableAgents: { id: string; name: string; role: string; scope: 'project' | 'global' }[]
    availableSkills: { id: string; name: string; scope: 'project' | 'global' }[]
  }): Promise<GeneratedWorkflow> {
    const res = await sc.request<GenerateResponse>('workflows.generate', params)
    return res.workflow
  }

  return {
    // state
    workflows,
    loaded,
    available,
    // getters
    workflowById,
    // actions
    loadWorkflows,
    createWorkflow,
    saveWorkflow,
    renameWorkflow,
    deleteWorkflow,
    updateWorkflowNodes,
    updateWorkflowEdges,
    flushPendingPersist,
    generateWorkflow,
  }
})
