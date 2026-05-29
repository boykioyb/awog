import { defineStore } from 'pinia'
import type {
  Agent,
  AgentSource,
  Hook,
  MCPServer,
  Project,
  Run,
  Skill,
  SkillSource,
  SlashCommand,
  Task,
  TaskSource,
  Workflow,
  WorkflowNode,
} from '~/types'
import { topoSort } from '~/utils/graph'
import { INITIAL_PROJECTS, INITIAL_TASKS, INITIAL_WORKFLOWS } from '~/utils/initial-data'
import { INITIAL_COMMANDS, INITIAL_HOOKS } from '~/utils/initial-extensions'
import { makeLiveTrace, makeTrace, mockOutput } from '~/utils/mock-output'
import { nowIso } from '~/utils/time'

interface CreateTaskInput {
  title: string
  description: string
  source: TaskSource
  workflowId: string
  projectId: string
}

export interface LinkProjectInput {
  name: string
  path: string
  description: string
  language: string
  gitRemote: string
  gitBranch: string
}

export interface CloneProjectInput {
  name: string
  destPath: string
  gitRemote: string
  description: string
  language: string
}

interface ProjectsListResponse {
  projects: Project[]
}
interface ProjectUpsertResponse {
  project: Project
}
interface ProjectCloneResponse {
  project: Project
}

export interface SkillScanReport {
  dir: string
  source: SkillSource
  found: number
}
interface SkillsListResponse {
  skills: Skill[]
  reports?: SkillScanReport[]
}
interface SkillUpsertResponse {
  skill: Skill
}

export interface AgentScanReport {
  dir: string
  source: AgentSource
  found: number
}

let projectIdCounter = 0
const newProjectId = (): string =>
  `prj-${Date.now().toString(36)}-${(projectIdCounter++).toString(36)}`

// Strip the runtime fields (status / tools / resources / lastError) when sending
// a MCPServer to `mcp.upsert` — the sidecar only persists the config shape and
// rebuilds those fields from the McpManager snapshot on its way back.
const RUNTIME_KEYS: ReadonlyArray<keyof MCPServer> = ['status', 'tools', 'resources', 'lastError']

function stripRuntimeFields(
  s: MCPServer,
): Omit<MCPServer, 'status' | 'tools' | 'resources' | 'lastError'> {
  // Sidecar zod schema accepts the config shape only; rebuild without the
  // runtime fields the manager owns.
  const entries = (Object.keys(s) as Array<keyof MCPServer>)
    .filter((k) => !RUNTIME_KEYS.includes(k))
    .map((k) => [k, s[k]] as const)
  return Object.fromEntries(entries) as Omit<
    MCPServer,
    'status' | 'tools' | 'resources' | 'lastError'
  >
}

export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    // Projects hydrate from sidecar (~/.awog/projects/<id>.json). Browser dev
    // (no sidecar) falls back to INITIAL_PROJECTS inside hydrateProjectsFromSidecar.
    projects: [] as Project[],
    // Agents hydrate from sidecar across 5 tiers (mirror Skills). Each file is
    // an AGENT.md (YAML frontmatter + body) compatible with Claude Code SDK
    // subagent format. No mock seed — user creates agents explicitly.
    agents: [] as Agent[],
    // Per-tier scan report (matches Skills). Surfaces resolved paths +
    // scan counts so misconfigured HOME / missing dirs are diagnosable.
    agentScanReports: [] as AgentScanReport[],
    // Skills hydrate from sidecar (~/.awog/skills/<id>/SKILL.md). No mock seed —
    // user creates skills explicitly.
    skills: [] as Skill[],
    // Latest scan report (1 entry per scanned dir + count). Surfaces resolved
    // paths to the UI so misconfigured HOME / missing dirs are diagnosable.
    skillScanReports: [] as SkillScanReport[],
    workflows: [...INITIAL_WORKFLOWS] as Workflow[],
    tasks: [...INITIAL_TASKS] as Task[],
    // MCP servers hydrate from sidecar (`~/.awog/mcp-servers/<id>.json`). No
    // mock seed — empty until `hydrateMcpFromSidecar` populates it.
    mcpServers: [] as MCPServer[],
    // 100-line stderr ring buffer per server id, surfaced in the McpDetail Logs
    // tab. Populated via the `mcp.stderr-line` sidecar event subscription.
    mcpStderr: {} as Record<string, string[]>,
    hooks: [...INITIAL_HOOKS] as Hook[],
    commands: [...INITIAL_COMMANDS] as SlashCommand[],
    selectedTaskId: 'tsk-001' as string | null,
  }),

  getters: {
    selectedTask(state): Task | undefined {
      return state.tasks.find((t: Task) => t.id === state.selectedTaskId)
    },
    projectById:
      (state) =>
      (id: string): Project | undefined =>
        state.projects.find((p: Project) => p.id === id),
    workflowById:
      (state) =>
      (id: string): Workflow | undefined =>
        state.workflows.find((w: Workflow) => w.id === id),
    agentById:
      (state) =>
      (id: string): Agent | undefined =>
        state.agents.find((a: Agent) => a.id === id),
    skillById:
      (state) =>
      (id: string): Skill | undefined =>
        state.skills.find((s: Skill) => s.id === id),
    taskById:
      (state) =>
      (id: string): Task | undefined =>
        state.tasks.find((t: Task) => t.id === id),
  },

  actions: {
    selectTask(id: string | null) {
      this.selectedTaskId = id
    },

    deleteTask(id: string) {
      this.tasks = this.tasks.filter((t: Task) => t.id !== id)
      if (this.selectedTaskId === id) {
        this.selectedTaskId = this.tasks[0]?.id ?? null
      }
    },

    renameTask(id: string, title: string) {
      const task = this.tasks.find((t: Task) => t.id === id)
      if (task) task.title = title
    },

    createTask(data: CreateTaskInput) {
      const wf = this.workflows.find((w: Workflow) => w.id === data.workflowId)
      if (!wf) return
      const phases: Task['phases'] = {}
      wf.nodes.forEach((n: WorkflowNode) => {
        const sk = this.skills.find((s: Skill) => s.id === n.skillId)
        phases[n.id] = {
          nodeId: n.id,
          status: 'pending',
          skillName: sk?.name || 'unknown',
          runs: [],
        }
      })
      const newId = `tsk-${String(this.tasks.length + 1).padStart(3, '0')}`
      const newTask: Task = {
        id: newId,
        title: data.title,
        description: data.description,
        source: data.source,
        projectId: data.projectId,
        workflowId: data.workflowId,
        status: 'queued',
        currentNodeId: null,
        waitingApproval: null,
        waitingConnection: null,
        createdAt: 'Just now',
        phases,
      }
      this.tasks.unshift(newTask)
      this.selectedTaskId = newId
    },

    sendMessageToPhase(taskId: string, nodeId: string, runVersion: number, text: string) {
      const task = this.tasks.find((t: Task) => t.id === taskId)
      if (!task) return
      const phase = task.phases[nodeId]
      if (!phase) return
      const run = phase.runs.find((r: Run) => r.version === runVersion)
      if (!run) return
      run.messages.push({ role: 'user', text, at: 'Just now' })

      setTimeout(() => {
        const t2 = this.tasks.find((t: Task) => t.id === taskId)
        const ph2 = t2?.phases[nodeId]
        const r2 = ph2?.runs.find((r: Run) => r.version === runVersion)
        if (r2) {
          r2.messages.push({
            role: 'agent',
            text: 'Understood. I will incorporate this feedback when you trigger a rerun.',
            at: 'Just now',
          })
        }
      }, 1500)
    },

    rerunFromPhase(taskId: string, nodeId: string, instruction: string) {
      const task = this.tasks.find((t: Task) => t.id === taskId)
      if (!task) return
      const wf = this.workflows.find((w: Workflow) => w.id === task.workflowId)
      if (!wf) return

      const order = topoSort(wf.nodes, wf.edges)
      const startIdx = order.indexOf(nodeId)
      const downstream = order.slice(startIdx)

      downstream.forEach((nid: string, i: number) => {
        const phase = task.phases[nid]
        if (!phase) return
        if (i === 0) {
          const newRunVersion = (phase.runs[phase.runs.length - 1]?.version || 0) + 1
          phase.runs = phase.runs.map((r: Run) =>
            r.status === 'completed' ? { ...r, status: 'superseded' as const } : r,
          )
          const node = wf.nodes.find((n: WorkflowNode) => n.id === nid)!
          phase.runs.push({
            version: newRunVersion,
            status: 'running',
            output: '',
            trace: makeLiveTrace(node.agentId),
            messages: instruction ? [{ role: 'user', text: instruction, at: 'Just now' }] : [],
            duration: null,
            triggeredBy: 'rerun',
          })
          phase.status = 'running'
        } else {
          phase.runs = phase.runs.map((r: Run) => ({ ...r, status: 'superseded' as const }))
          phase.status = 'pending'
        }
      })
      task.status = 'running'
      task.currentNodeId = nodeId
      task.waitingApproval = null

      // Simulate completion
      setTimeout(() => {
        const t2 = this.tasks.find((t: Task) => t.id === taskId)
        const ph = t2?.phases[nodeId]
        if (!ph) return
        const latest = ph.runs[ph.runs.length - 1]
        if (!latest) return
        const node = wf.nodes.find((n: WorkflowNode) => n.id === nodeId)!
        const kindBySkill: Record<string, string> = {
          gather_requirements: 'requirements',
          design_architecture: 'architecture',
          fix_bug: 'fix',
        }
        const kind = kindBySkill[ph.skillName] ?? 'review'
        latest.status = node.approval ? 'waiting_approval' : 'completed'
        latest.output = mockOutput(ph.skillName)
        latest.trace = makeTrace(node.agentId, kind as never)
        latest.duration = '38s'
        ph.status = node.approval ? 'waiting_approval' : 'completed'
        if (node.approval && t2) {
          t2.status = 'waiting_approval'
          t2.waitingApproval = nodeId
        }
      }, 3000)
    },

    approvePhase(taskId: string, nodeId: string) {
      const task = this.tasks.find((t: Task) => t.id === taskId)
      if (!task) return
      const wf = this.workflows.find((w: Workflow) => w.id === task.workflowId)
      if (!wf) return

      const order = topoSort(wf.nodes, wf.edges)
      const idx = order.indexOf(nodeId)
      const isLast = idx === order.length - 1
      const nextNodeId: string | null = isLast ? null : (order[idx + 1] ?? null)

      const phase = task.phases[nodeId]
      if (!phase) return
      phase.status = 'completed'
      const last = phase.runs[phase.runs.length - 1]
      if (last) {
        last.status = 'completed'
        last.approvedBy = 'human'
        last.approvedAt = 'Just now'
      }
      task.status = isLast ? 'completed' : 'running'
      task.currentNodeId = nextNodeId
      task.waitingApproval = null

      if (nextNodeId) {
        setTimeout(() => {
          const t2 = this.tasks.find((t: Task) => t.id === taskId)
          const nextPhase = t2?.phases[nextNodeId]
          const nextNode = wf.nodes.find((n: WorkflowNode) => n.id === nextNodeId)
          if (nextPhase && nextNode) {
            nextPhase.status = 'running'
            nextPhase.runs = [
              {
                version: 1,
                status: 'running',
                output: '',
                trace: makeLiveTrace(nextNode.agentId),
                messages: [],
                duration: null,
              },
            ]
          }
        }, 600)
      }
    },

    // Project CRUD — persisted via sidecar (~/.awog/projects/<id>.json).
    // Browser dev (no sidecar): keep mock data + local-only mutations.

    async hydrateProjectsFromSidecar(): Promise<void> {
      const sidecar = useSidecar()
      if (!sidecar.available) {
        // Browser dev: seed mock so the UI is browsable without a Tauri shell.
        if (this.projects.length === 0) this.projects = [...INITIAL_PROJECTS]
        return
      }
      try {
        const res = await sidecar.request<ProjectsListResponse>('projects.list')
        this.projects = Array.isArray(res.projects) ? res.projects : []
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[workspace] hydrateProjectsFromSidecar failed', err)
      }
    },

    // Register an existing local folder as a project. Sidecar validates the
    // path exists and is a directory; throws an Error the caller surfaces.
    async linkProject(input: LinkProjectInput): Promise<Project> {
      const sidecar = useSidecar()
      const draft: Project = {
        id: newProjectId(),
        name: input.name,
        path: input.path,
        description: input.description,
        gitRemote: input.gitRemote,
        gitBranch: input.gitBranch,
        language: input.language,
        createdAt: nowIso(),
      }
      if (sidecar.available) {
        const res = await sidecar.request<ProjectUpsertResponse>('projects.upsert', {
          project: draft,
          mode: 'create',
        })
        this.projects.unshift(res.project)
        return res.project
      }
      this.projects.unshift(draft)
      return draft
    },

    // Clone a git remote into destPath and register the result. Sidecar runs
    // git clone with arg-array (no shell), enforces remote scheme allowlist,
    // and rejects if destPath already exists.
    async cloneProject(input: CloneProjectInput): Promise<Project> {
      const sidecar = useSidecar()
      const id = newProjectId()
      const createdAt = nowIso()
      if (sidecar.available) {
        const res = await sidecar.request<ProjectCloneResponse>('projects.clone', {
          id,
          name: input.name,
          gitRemote: input.gitRemote,
          destPath: input.destPath,
          description: input.description,
          language: input.language,
          createdAt,
        })
        this.projects.unshift(res.project)
        return res.project
      }
      // Browser dev fallback: pretend the clone succeeded.
      const local: Project = {
        id,
        name: input.name,
        path: input.destPath,
        description: input.description,
        gitRemote: input.gitRemote,
        gitBranch: 'main',
        language: input.language,
        createdAt,
      }
      this.projects.unshift(local)
      return local
    },

    async updateProject(project: Project): Promise<Project> {
      const sidecar = useSidecar()
      if (sidecar.available) {
        const res = await sidecar.request<ProjectUpsertResponse>('projects.upsert', {
          project,
          mode: 'update',
        })
        const existing = this.projects.find((p: Project) => p.id === res.project.id)
        if (existing) Object.assign(existing, res.project)
        return res.project
      }
      const existing = this.projects.find((p: Project) => p.id === project.id)
      if (existing) Object.assign(existing, project)
      return project
    },

    async deleteProject(id: string): Promise<void> {
      this.projects = this.projects.filter((p: Project) => p.id !== id)
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        await sidecar.request('projects.delete', { id })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[workspace] projects.delete failed', err)
      }
    },

    // Agent CRUD — persisted via sidecar across 5 tiers (mirror Skills):
    //   global / user-claude / user-agents / project-claude / project-agents
    // Each agent is uniquely identified by (id, source, projectId). Browser
    // dev (no sidecar): local-only mutations so the page stays browsable.

    async hydrateAgentsFromSidecar(projectIds?: string[]): Promise<void> {
      const sidecar = useSidecar()
      // eslint-disable-next-line no-console
      console.log('%c[agents] hydrate begin', 'color: #10b981; font-weight: bold', {
        sidecarAvailable: sidecar.available,
        projectsInStore: this.projects.length,
        projectPaths: this.projects.map((p: Project) => ({ id: p.id, path: p.path })),
      })
      if (!sidecar.available) return
      const ids = projectIds ?? this.projects.map((p: Project) => p.id)
      try {
        const params = ids.length > 0 ? { projectIds: ids } : undefined
        const res = await sidecar.request<{
          agents: Agent[]
          reports?: AgentScanReport[]
        }>('agents.list', params)
        // eslint-disable-next-line no-console
        console.log('%c[agents] hydrate response', 'color: #10b981; font-weight: bold', {
          agentsCount: Array.isArray(res.agents) ? res.agents.length : 'not-an-array',
          reports: res.reports,
          firstAgent: res.agents?.[0] ?? null,
        })
        this.agents = Array.isArray(res.agents) ? res.agents : []
        this.agentScanReports = Array.isArray(res.reports) ? res.reports : []
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[agents] hydrate failed', err)
      }
    },

    applyAgentSnapshot(agent: Agent) {
      const matchKey = (a: Agent, b: Pick<Agent, 'id' | 'source' | 'projectId'>) =>
        a.source === b.source &&
        (a.projectId ?? undefined) === (b.projectId ?? undefined) &&
        a.id === b.id
      const idx = this.agents.findIndex((a: Agent) => matchKey(a, agent))
      if (idx >= 0) {
        this.agents[idx] = agent
      } else {
        this.agents.push(agent)
      }
    },

    async saveAgent(data: Agent, previousId?: string): Promise<Agent> {
      const sidecar = useSidecar()
      const matchKey = (a: Agent, b: Pick<Agent, 'id' | 'source' | 'projectId'>) =>
        a.source === b.source &&
        (a.projectId ?? undefined) === (b.projectId ?? undefined) &&
        a.id === b.id
      const slugChanged = previousId !== undefined && previousId !== data.id
      const isUpdate = slugChanged || this.agents.some((a: Agent) => matchKey(a, data))
      if (sidecar.available) {
        const params: Record<string, unknown> = {
          agent: data,
          mode: isUpdate ? 'update' : 'create',
        }
        if (slugChanged) params.previousId = previousId
        const res = await sidecar.request<{ agent: Agent }>('agents.upsert', params)
        if (slugChanged) {
          this.agents = this.agents.filter(
            (a: Agent) =>
              !matchKey(a, {
                source: data.source,
                projectId: data.projectId,
                id: previousId as string,
              }),
          )
        }
        this.applyAgentSnapshot(res.agent)
        return res.agent
      }
      this.applyAgentSnapshot(data)
      return data
    },

    async deleteAgent(id: string, source: Agent['source'], projectId?: string): Promise<void> {
      const sidecar = useSidecar()
      if (sidecar.available) {
        const params: Record<string, unknown> = { id, source }
        if (projectId) params.projectId = projectId
        await sidecar.request('agents.delete', params)
      }
      this.agents = this.agents.filter(
        (a: Agent) =>
          !(a.id === id && a.source === source && (a.projectId ?? undefined) === projectId),
      )
    },

    async duplicateAgent(agent: Agent): Promise<Agent> {
      // Slug uniqueness is per-tier — only check agents in the SAME source+projectId.
      const base = `${agent.id}-copy`
      const taken = new Set(
        this.agents
          .filter(
            (a: Agent) =>
              a.source === agent.source && (a.projectId ?? undefined) === agent.projectId,
          )
          .map((a: Agent) => a.id),
      )
      const candidate = taken.has(base)
        ? (Array.from({ length: 99 }, (_, i: number) => `${base}-${i + 2}`).find(
            (c: string) => !taken.has(c),
          ) ?? `${base}-${Date.now().toString(36)}`)
        : base
      const newAgent: Agent = { ...agent, id: candidate, name: `${agent.name} (Copy)` }
      return this.saveAgent(newAgent)
    },

    // Skill CRUD — persisted via sidecar. Each skill is identified by the
    // tuple (source, projectId, id), so the same slug can live independently
    // in global, project-claude, and project-agents tiers. Browser dev (no
    // sidecar): keep local-only mutations so the page is browsable.

    async hydrateSkillsFromSidecar(projectIds?: string[]): Promise<void> {
      const sidecar = useSidecar()
      // eslint-disable-next-line no-console
      console.log('%c[skills] hydrate begin', 'color: #10b981; font-weight: bold', {
        sidecarAvailable: sidecar.available,
        projectsInStore: this.projects.length,
      })
      if (!sidecar.available) return
      // Default: include all registered projects so a fresh /skills page reload
      // sees both user-level dirs and every project's .claude/.agents skills.
      const ids = projectIds ?? this.projects.map((p: Project) => p.id)
      try {
        const params = ids.length > 0 ? { projectIds: ids } : undefined
        const res = await sidecar.request<SkillsListResponse>('skills.list', params)
        // eslint-disable-next-line no-console
        console.log('%c[skills] hydrate response', 'color: #10b981; font-weight: bold', {
          rawKeys: Object.keys(res ?? {}),
          skillsCount: Array.isArray(res.skills) ? res.skills.length : 'not-an-array',
          reportsCount: Array.isArray(res.reports) ? res.reports.length : 'missing',
          reports: res.reports,
          firstSkill: res.skills?.[0] ?? null,
        })
        this.skills = Array.isArray(res.skills) ? res.skills : []
        this.skillScanReports = Array.isArray(res.reports) ? res.reports : []
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[skills] hydrate failed', err)
      }
    },

    async saveSkill(data: Skill, previousId?: string): Promise<Skill> {
      const sidecar = useSidecar()
      const matchKey = (a: Skill, b: { source: SkillSource; projectId?: string; id: string }) =>
        a.source === b.source &&
        (a.projectId ?? undefined) === (b.projectId ?? undefined) &&
        a.id === b.id
      const slugChanged = previousId !== undefined && previousId !== data.id
      const targetKey = { source: data.source, projectId: data.projectId, id: data.id }
      const isUpdate = slugChanged || this.skills.some((s: Skill) => matchKey(s, targetKey))
      if (sidecar.available) {
        const params: Record<string, unknown> = {
          skill: data,
          mode: isUpdate ? 'update' : 'create',
        }
        if (slugChanged) params.previousId = previousId
        const res = await sidecar.request<SkillUpsertResponse>('skills.upsert', params)
        if (slugChanged) {
          this.skills = this.skills.filter(
            (s: Skill) =>
              !matchKey(s, {
                source: data.source,
                projectId: data.projectId,
                id: previousId as string,
              }),
          )
        }
        const existing = this.skills.find((s: Skill) => matchKey(s, res.skill))
        if (existing) {
          Object.assign(existing, res.skill)
        } else {
          this.skills.push(res.skill)
        }
        return res.skill
      }
      if (slugChanged) {
        this.skills = this.skills.filter(
          (s: Skill) =>
            !matchKey(s, {
              source: data.source,
              projectId: data.projectId,
              id: previousId as string,
            }),
        )
      }
      const existing = this.skills.find((s: Skill) => matchKey(s, targetKey))
      if (existing) {
        Object.assign(existing, data)
      } else {
        this.skills.push({ ...data })
      }
      return data
    },

    async deleteSkill(id: string, source: SkillSource, projectId?: string): Promise<void> {
      this.skills = this.skills.filter(
        (s: Skill) =>
          !(
            s.id === id &&
            s.source === source &&
            (s.projectId ?? undefined) === (projectId ?? undefined)
          ),
      )
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        const params: Record<string, unknown> = { id, source }
        if (projectId) params.projectId = projectId
        await sidecar.request('skills.delete', params)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[workspace] skills.delete failed', err)
      }
    },

    // Workflow CRUD
    saveWorkflow(workflow: Workflow) {
      const existing = this.workflows.find((w: Workflow) => w.id === workflow.id)
      if (existing) {
        Object.assign(existing, workflow)
      } else {
        this.workflows.push({ ...workflow, id: workflow.id || `wf${Date.now()}` })
      }
    },
    updateWorkflowNodes(workflowId: string, nodes: Workflow['nodes']) {
      const wf = this.workflows.find((w: Workflow) => w.id === workflowId)
      if (wf) wf.nodes = nodes
    },
    updateWorkflowEdges(workflowId: string, edges: Workflow['edges']) {
      const wf = this.workflows.find((w: Workflow) => w.id === workflowId)
      if (wf) wf.edges = edges
    },
    deleteWorkflow(id: string) {
      this.workflows = this.workflows.filter((w: Workflow) => w.id !== id)
    },

    renameWorkflow(id: string, name: string) {
      const wf = this.workflows.find((w: Workflow) => w.id === id)
      if (wf) wf.name = name
    },

    createWorkflow(name: string): Workflow {
      const newWf: Workflow = {
        id: `wf${Date.now()}`,
        name,
        description: 'New workflow',
        nodes: [],
        edges: [],
      }
      this.workflows.push(newWf)
      return newWf
    },

    // MCP Server — persisted via sidecar (~/.awog/mcp-servers/<id>.json).
    // Browser dev (no sidecar): keep mock seed so the page is browsable.

    async hydrateMcpFromSidecar(): Promise<void> {
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        const res = await sidecar.request<{ servers: MCPServer[] }>('mcp.list')
        this.mcpServers = Array.isArray(res.servers) ? res.servers : []
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[mcp] hydrate failed', err)
      }
    },

    // Filesystem watcher subscribe (Sprint 3 C1). Sidecar emits
    // `agents.fs-changed`, `skills.fs-changed`, `mcp-servers.fs-changed`
    // (debounced 500ms) when files are touched outside the app. We re-hydrate
    // the matching store section so the UI reflects disk truth without the
    // user clicking 🔄. Each store handles its own throttling (re-hydrate
    // returns same data fast if disk hasn't changed). Returns unsubscribe fn.
    async subscribeFsEvents(): Promise<() => void> {
      const sidecar = useSidecar()
      if (!sidecar.available) return () => {}
      try {
        const unlisten = await sidecar.onEvent((evt) => {
          // Fire-and-forget hydrate. Each store action logs its own errors
          // (already wired) so a swallow handler is fine here.
          const swallow = () => {
            // intentional no-op
          }
          if (evt.type === 'agents.fs-changed') {
            this.hydrateAgentsFromSidecar().catch(swallow)
            return
          }
          if (evt.type === 'skills.fs-changed') {
            this.hydrateSkillsFromSidecar().catch(swallow)
            return
          }
          if (evt.type === 'mcp-servers.fs-changed') {
            this.hydrateMcpFromSidecar().catch(swallow)
          }
        })
        return unlisten
      } catch {
        return () => {}
      }
    },

    async subscribeMcpEvents(): Promise<() => void> {
      const sidecar = useSidecar()
      if (!sidecar.available) return () => {}
      try {
        const unlisten = await sidecar.onEvent((evt) => {
          if (evt.type === 'mcp.status') {
            const p = evt.payload as {
              id?: string
              status?: MCPServer['status']
              lastError?: string
              tools?: MCPServer['tools']
              resources?: MCPServer['resources']
              lastStartedAt?: string
            }
            if (typeof p.id !== 'string') return
            const target = this.mcpServers.find((s: MCPServer) => s.id === p.id)
            if (!target) return
            if (p.status) target.status = p.status
            target.lastError = p.lastError
            if (Array.isArray(p.tools)) target.tools = p.tools
            if (Array.isArray(p.resources)) target.resources = p.resources
            return
          }
          if (evt.type === 'mcp.stderr-line') {
            const p = evt.payload as { id?: string; line?: string }
            if (typeof p.id !== 'string' || typeof p.line !== 'string') return
            const ring = this.mcpStderr[p.id] ?? []
            ring.push(p.line)
            if (ring.length > 100) ring.splice(0, ring.length - 100)
            this.mcpStderr[p.id] = ring
          }
        })
        return unlisten
      } catch {
        return () => {}
      }
    },

    applyMcpServerSnapshot(server: MCPServer) {
      const idx = this.mcpServers.findIndex((s: MCPServer) => s.id === server.id)
      if (idx >= 0) {
        this.mcpServers[idx] = server
      } else {
        this.mcpServers.push(server)
      }
    },

    async saveMCPServer(data: MCPServer): Promise<MCPServer> {
      const sidecar = useSidecar()
      const isUpdate = this.mcpServers.some((s: MCPServer) => s.id === data.id)
      if (sidecar.available) {
        const res = await sidecar.request<{ server: MCPServer }>('mcp.upsert', {
          server: stripRuntimeFields(data),
          mode: isUpdate ? 'update' : 'create',
        })
        this.applyMcpServerSnapshot(res.server)
        return res.server
      }
      // Local-only fallback (browser dev).
      const next = { ...data, id: data.id || `mcp${Date.now()}` }
      this.applyMcpServerSnapshot(next)
      return next
    },

    async deleteMCPServer(id: string): Promise<void> {
      const sidecar = useSidecar()
      if (sidecar.available) {
        await sidecar.request('mcp.delete', { id })
      }
      this.mcpServers = this.mcpServers.filter((s: MCPServer) => s.id !== id)
    },

    async toggleMCPServer(id: string): Promise<void> {
      const target = this.mcpServers.find((s: MCPServer) => s.id === id)
      if (!target) return
      const sidecar = useSidecar()
      const nextEnabled = !target.enabled
      if (sidecar.available) {
        const res = await sidecar.request<{ server: MCPServer }>('mcp.toggle', {
          id,
          enabled: nextEnabled,
        })
        this.applyMcpServerSnapshot(res.server)
        return
      }
      target.enabled = nextEnabled
      let nextStatus: MCPServer['status']
      if (!nextEnabled) nextStatus = 'disabled'
      else if (target.autoStart) nextStatus = 'running'
      else nextStatus = 'idle'
      target.status = nextStatus
      if (nextEnabled) target.lastError = undefined
    },

    async toggleMCPToolDeny(id: string, toolName: string): Promise<void> {
      const target = this.mcpServers.find((s: MCPServer) => s.id === id)
      if (!target) return
      const isDenied = target.deniedTools?.includes(toolName) ?? false
      const sidecar = useSidecar()
      if (sidecar.available) {
        const res = await sidecar.request<{ server: MCPServer }>('mcp.toggle-tool', {
          id,
          toolName,
          denied: !isDenied,
        })
        this.applyMcpServerSnapshot(res.server)
        return
      }
      // Browser dev fallback: mutate in place.
      const next = new Set(target.deniedTools ?? [])
      if (isDenied) next.delete(toolName)
      else next.add(toolName)
      target.deniedTools = next.size > 0 ? [...next].sort() : undefined
    },

    async restartMCPServer(id: string): Promise<void> {
      const sidecar = useSidecar()
      if (sidecar.available) {
        const res = await sidecar.request<{ server: MCPServer }>('mcp.restart', { id })
        this.applyMcpServerSnapshot(res.server)
        return
      }
      const s = this.mcpServers.find((x: MCPServer) => x.id === id)
      if (s) s.status = 'starting'
    },

    // Hook CRUD
    saveHook(data: Hook) {
      const existing = this.hooks.find((h: Hook) => h.id === data.id)
      if (existing) {
        Object.assign(existing, data)
      } else {
        this.hooks.push({ ...data, id: data.id || `hk${Date.now()}` })
      }
    },
    deleteHook(id: string) {
      this.hooks = this.hooks.filter((h: Hook) => h.id !== id)
    },
    toggleHook(id: string) {
      const h = this.hooks.find((x: Hook) => x.id === id)
      if (h) h.enabled = !h.enabled
    },
    runHookOnce(id: string) {
      const h = this.hooks.find((x: Hook) => x.id === id)
      if (!h) return
      const start = Date.now()
      setTimeout(() => {
        h.recentRuns.unshift({
          at: 'Just now',
          durationMs: Date.now() - start + 300,
          exitCode: 0,
        })
        h.recentRuns = h.recentRuns.slice(0, 20)
      }, 400)
    },

    // Slash Command CRUD
    saveCommand(data: SlashCommand) {
      const existing = this.commands.find((c: SlashCommand) => c.id === data.id)
      if (existing) {
        Object.assign(existing, data)
      } else {
        this.commands.push({ ...data, id: data.id || `cmd${Date.now()}` })
      }
    },
    deleteCommand(id: string) {
      const c = this.commands.find((x: SlashCommand) => x.id === id)
      if (c?.system) return
      this.commands = this.commands.filter((x: SlashCommand) => x.id !== id)
    },
  },
})
