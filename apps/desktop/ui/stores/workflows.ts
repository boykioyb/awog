import { defineStore, acceptHMRUpdate } from 'pinia'
import type { Workflow, WorkflowSource } from '~/types'
import { useWorkspaceStore } from '~/stores/workspace'
import { INITIAL_WORKFLOWS } from '~/utils/initial-data'

interface WorkflowsListResponse {
  workflows: Workflow[]
}

// Fire-and-forget persistence. UI state stays optimistic — sidecar errors are
// logged but never block the user (mirrors stores/sessions.ts).
const pushToSidecar = (method: string, params: unknown): void => {
  const sidecar = useSidecar()
  if (!sidecar.available) return
  sidecar.request(method, params).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn(`[workflows] ${method} failed:`, err)
  })
}

// Debounce canvas-driven persistence: drag-stop / connect / disconnect fire
// update:nodes/edges in bursts. Coalesce per-workflow so we don't spam
// workflows.upsert. 500ms matches the sidecar fs-watcher debounce.
const PERSIST_DEBOUNCE_MS = 500
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const useWorkflowsStore = defineStore('workflows', {
  state: () => ({
    workflows: [] as Workflow[],
    hydrated: false,
  }),

  getters: {
    workflowById:
      (state) =>
      (id: string): Workflow | undefined =>
        state.workflows.find((w) => w.id === id),
  },

  actions: {
    async hydrateFromSidecar(): Promise<void> {
      if (this.hydrated) return
      const sidecar = useSidecar()
      // Browser-dev fallback: no Tauri shell → seed mock so the canvas is
      // browsable (mirrors workspace.hydrateProjectsFromSidecar).
      if (!sidecar.available) {
        if (!this.workflows.length) this.workflows = [...INITIAL_WORKFLOWS]
        this.hydrated = true
        return
      }
      try {
        // Project-tier workflows live in each project's repo, so scan needs the
        // registered project ids — ensure projects are hydrated first.
        const workspace = useWorkspaceStore()
        await workspace.hydrateProjectsFromSidecar()
        const projectIds = workspace.projects.map((p) => p.id)
        const res = await sidecar.request<WorkflowsListResponse>('workflows.list', { projectIds })
        this.workflows = res.workflows ?? []
        this.hydrated = true
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[workflows] hydrate failed:', err)
      }
    },

    // scope: 'global' (default, shared) or a projectId (lives in that repo).
    createWorkflow(name: string, scope: WorkflowSource | string = 'global'): Workflow {
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
      this.workflows.unshift(wf)
      pushToSidecar('workflows.upsert', { workflow: wf, mode: 'create' })
      return wf
    },

    saveWorkflow(workflow: Workflow): void {
      const existing = this.workflows.find((w) => w.id === workflow.id)
      if (existing) {
        Object.assign(existing, workflow)
      } else {
        this.workflows.unshift(workflow)
      }
      pushToSidecar('workflows.upsert', { workflow, mode: existing ? 'update' : 'create' })
    },

    renameWorkflow(id: string, name: string): void {
      const wf = this.workflows.find((w) => w.id === id)
      if (!wf) return
      wf.name = name
      pushToSidecar('workflows.upsert', { workflow: wf, mode: 'update' })
    },

    deleteWorkflow(id: string): void {
      const wf = this.workflows.find((w) => w.id === id)
      this.workflows = this.workflows.filter((w) => w.id !== id)
      const timer = persistTimers.get(id)
      if (timer) {
        clearTimeout(timer)
        persistTimers.delete(id)
      }
      pushToSidecar('workflows.delete', {
        id,
        source: wf?.source ?? 'global',
        ...(wf?.projectId ? { projectId: wf.projectId } : {}),
      })
    },

    // Canvas mutations: mutate local state immediately (instant UI) then schedule
    // a debounced upsert so rapid drag/connect bursts collapse into one RPC.
    updateWorkflowNodes(workflowId: string, nodes: Workflow['nodes']): void {
      const wf = this.workflows.find((w) => w.id === workflowId)
      if (!wf) return
      wf.nodes = nodes
      this.schedulePersist(workflowId)
    },

    updateWorkflowEdges(workflowId: string, edges: Workflow['edges']): void {
      const wf = this.workflows.find((w) => w.id === workflowId)
      if (!wf) return
      wf.edges = edges
      this.schedulePersist(workflowId)
    },

    schedulePersist(workflowId: string): void {
      const prev = persistTimers.get(workflowId)
      if (prev) clearTimeout(prev)
      persistTimers.set(
        workflowId,
        setTimeout(() => {
          persistTimers.delete(workflowId)
          const wf = this.workflows.find((w) => w.id === workflowId)
          if (wf) pushToSidecar('workflows.upsert', { workflow: wf, mode: 'update' })
        }, PERSIST_DEBOUNCE_MS),
      )
    },

    // Flush every pending debounce immediately — call on page unmount / before
    // switching workflow so an edit right before navigation is never lost.
    flushPendingPersist(): void {
      persistTimers.forEach((timer, id) => {
        clearTimeout(timer)
        const wf = this.workflows.find((w) => w.id === id)
        if (wf) pushToSidecar('workflows.upsert', { workflow: wf, mode: 'update' })
      })
      persistTimers.clear()
    },
  },
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useWorkflowsStore, import.meta.hot))
}
