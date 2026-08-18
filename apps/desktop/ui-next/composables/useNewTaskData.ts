import { computed, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'

// Fetches the data the New Task modal needs — workflows, projects, enabled
// connections (MCP servers) — directly over IPC. SoC: the Tasks feature does NOT
// import the workflows/projects/connections Pinia stores (other agents own
// those), so this composable reaches the sidecar itself with minimal slices.
// Without the bridge every list stays empty. One round-trip per modal open via
// `load()`.

export type WorkflowOption = {
  id: string
  name: string
  description: string
  projectId?: string
  source?: 'global' | 'project'
  // Snapshot slice forwarded to the store on create so the optimistic detail view
  // renders the pipeline before the engine returns its own snapshot.
  nodes: { id: string; agentId: string; agentName?: string; skillId: string; approval?: boolean }[]
  edges: { from: string; to: string }[]
}

// Local (not exported) to avoid a Nuxt auto-import name clash with
// useProjects.ts's ProjectOption ({id,name}); consumers use ReturnType<typeof
// useNewTaskData>, never this type by name.
type ProjectOption = { id: string; name: string; path: string }
export type ConnectionOption = { id: string; name: string }

// ── Sidecar DTO slices (only the fields the modal binds) ──

type WorkflowDto = {
  id: string
  name: string
  description?: string
  projectId?: string
  source?: 'global' | 'project'
  nodes?: {
    id: string
    agentId: string
    agentName?: string
    skillId: string
    approval?: boolean
  }[]
  edges?: { from: string; to: string }[]
}
type ProjectDto = { id: string; name: string; path: string }
// Source list slice (ADR 0060 `source.list`) — only the fields the modal binds.
type SourceDto = { id: string; name: string; enabled?: boolean }

export function useNewTaskData() {
  const sc = useSidecar()

  const workflows = ref<WorkflowOption[]>([])
  const projects = ref<ProjectOption[]>([])
  const connections = ref<ConnectionOption[]>([])
  const loading = ref(false)

  async function load(): Promise<void> {
    if (!sc.available) return
    loading.value = true
    try {
      const [wf, pr, mc] = await Promise.all([
        sc.request<{ workflows: WorkflowDto[] }>('workflows.list', {}).catch(() => ({
          workflows: [] as WorkflowDto[],
        })),
        sc.request<{ projects: ProjectDto[] }>('projects.list', {}).catch(() => ({
          projects: [] as ProjectDto[],
        })),
        sc.request<{ sources: SourceDto[] }>('source.list', {}).catch(() => ({
          sources: [] as SourceDto[],
        })),
      ])
      workflows.value = (wf.workflows ?? []).map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description ?? '',
        ...(w.projectId ? { projectId: w.projectId } : {}),
        ...(w.source ? { source: w.source } : {}),
        nodes: w.nodes ?? [],
        edges: w.edges ?? [],
      }))
      projects.value = (pr.projects ?? []).map((p) => ({ id: p.id, name: p.name, path: p.path }))
      connections.value = (mc.sources ?? [])
        .filter((s) => s.enabled !== false)
        .map((s) => ({ id: s.id, name: s.name }))
    } catch (err) {
      console.warn('[tasks] new-task data load failed', err)
    } finally {
      loading.value = false
    }
  }

  // Workflows offered for a project: global (shared) + that project's own
  // (per-project workflow scoping — ADR 0024 follow-up).
  const workflowsForProject = (projectId: string): WorkflowOption[] =>
    workflows.value.filter((w) => (w.source ?? 'global') === 'global' || w.projectId === projectId)

  return {
    workflows: computed(() => workflows.value),
    projects: computed(() => projects.value),
    connections: computed(() => connections.value),
    loading,
    load,
    workflowsForProject,
  }
}
