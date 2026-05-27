import { defineStore } from 'pinia'
import type {
  Agent,
  Hook,
  MCPServer,
  Project,
  Skill,
  SlashCommand,
  Task,
  TaskSource,
  Workflow,
} from '~/types'
import { topoSort } from '~/utils/graph'
import {
  INITIAL_AGENTS,
  INITIAL_PROJECTS,
  INITIAL_SKILLS,
  INITIAL_TASKS,
  INITIAL_WORKFLOWS,
} from '~/utils/initial-data'
import { INITIAL_COMMANDS, INITIAL_HOOKS, INITIAL_MCP_SERVERS } from '~/utils/initial-extensions'
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

let projectIdCounter = 0
const newProjectId = (): string =>
  `prj-${Date.now().toString(36)}-${(projectIdCounter++).toString(36)}`

export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    projects: [...INITIAL_PROJECTS] as Project[],
    agents: [...INITIAL_AGENTS] as Agent[],
    skills: [...INITIAL_SKILLS] as Skill[],
    workflows: [...INITIAL_WORKFLOWS] as Workflow[],
    tasks: [...INITIAL_TASKS] as Task[],
    mcpServers: [...INITIAL_MCP_SERVERS] as MCPServer[],
    hooks: [...INITIAL_HOOKS] as Hook[],
    commands: [...INITIAL_COMMANDS] as SlashCommand[],
    selectedTaskId: 'tsk-001' as string | null,
  }),

  getters: {
    selectedTask(state): Task | undefined {
      return state.tasks.find((t) => t.id === state.selectedTaskId)
    },
    projectById:
      (state) =>
      (id: string): Project | undefined =>
        state.projects.find((p) => p.id === id),
    workflowById:
      (state) =>
      (id: string): Workflow | undefined =>
        state.workflows.find((w) => w.id === id),
    agentById:
      (state) =>
      (id: string): Agent | undefined =>
        state.agents.find((a) => a.id === id),
    skillById:
      (state) =>
      (id: string): Skill | undefined =>
        state.skills.find((s) => s.id === id),
    taskById:
      (state) =>
      (id: string): Task | undefined =>
        state.tasks.find((t) => t.id === id),
  },

  actions: {
    selectTask(id: string | null) {
      this.selectedTaskId = id
    },

    deleteTask(id: string) {
      this.tasks = this.tasks.filter((t) => t.id !== id)
      if (this.selectedTaskId === id) {
        this.selectedTaskId = this.tasks[0]?.id ?? null
      }
    },

    renameTask(id: string, title: string) {
      const task = this.tasks.find((t) => t.id === id)
      if (task) task.title = title
    },

    createTask(data: CreateTaskInput) {
      const wf = this.workflows.find((w) => w.id === data.workflowId)
      if (!wf) return
      const phases: Task['phases'] = {}
      wf.nodes.forEach((n) => {
        const sk = this.skills.find((s) => s.id === n.skillId)
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
      const task = this.tasks.find((t) => t.id === taskId)
      if (!task) return
      const phase = task.phases[nodeId]
      if (!phase) return
      const run = phase.runs.find((r) => r.version === runVersion)
      if (!run) return
      run.messages.push({ role: 'user', text, at: 'Just now' })

      setTimeout(() => {
        const t2 = this.tasks.find((t) => t.id === taskId)
        const ph2 = t2?.phases[nodeId]
        const r2 = ph2?.runs.find((r) => r.version === runVersion)
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
      const task = this.tasks.find((t) => t.id === taskId)
      if (!task) return
      const wf = this.workflows.find((w) => w.id === task.workflowId)
      if (!wf) return

      const order = topoSort(wf.nodes, wf.edges)
      const startIdx = order.indexOf(nodeId)
      const downstream = order.slice(startIdx)

      downstream.forEach((nid, i) => {
        const phase = task.phases[nid]
        if (!phase) return
        if (i === 0) {
          const newRunVersion = (phase.runs[phase.runs.length - 1]?.version || 0) + 1
          phase.runs = phase.runs.map((r) =>
            r.status === 'completed' ? { ...r, status: 'superseded' as const } : r,
          )
          const node = wf.nodes.find((n) => n.id === nid)!
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
          phase.runs = phase.runs.map((r) => ({ ...r, status: 'superseded' as const }))
          phase.status = 'pending'
        }
      })
      task.status = 'running'
      task.currentNodeId = nodeId
      task.waitingApproval = null

      // Simulate completion
      setTimeout(() => {
        const t2 = this.tasks.find((t) => t.id === taskId)
        const ph = t2?.phases[nodeId]
        if (!ph) return
        const latest = ph.runs[ph.runs.length - 1]
        if (!latest) return
        const node = wf.nodes.find((n) => n.id === nodeId)!
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
      const task = this.tasks.find((t) => t.id === taskId)
      if (!task) return
      const wf = this.workflows.find((w) => w.id === task.workflowId)
      if (!wf) return

      const order = topoSort(wf.nodes, wf.edges)
      const idx = order.indexOf(nodeId)
      const isLast = idx === order.length - 1
      const nextNodeId = isLast ? null : order[idx + 1]

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
          const t2 = this.tasks.find((t) => t.id === taskId)
          const nextPhase = t2?.phases[nextNodeId]
          const nextNode = wf.nodes.find((n) => n.id === nextNodeId)
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
      if (!sidecar.available) return
      try {
        const res = await sidecar.request<ProjectsListResponse>('projects.list')
        const list = Array.isArray(res.projects) ? res.projects : []
        this.projects = list
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
        const existing = this.projects.find((p) => p.id === res.project.id)
        if (existing) Object.assign(existing, res.project)
        return res.project
      }
      const existing = this.projects.find((p) => p.id === project.id)
      if (existing) Object.assign(existing, project)
      return project
    },

    async deleteProject(id: string): Promise<void> {
      this.projects = this.projects.filter((p) => p.id !== id)
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        await sidecar.request('projects.delete', { id })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[workspace] projects.delete failed', err)
      }
    },

    // Agent CRUD
    saveAgent(data: Agent) {
      const existing = this.agents.find((a) => a.id === data.id)
      if (existing) {
        Object.assign(existing, data)
      } else {
        this.agents.push({ ...data, id: `ag${Date.now()}` })
      }
    },
    deleteAgent(id: string) {
      this.agents = this.agents.filter((a) => a.id !== id)
    },
    duplicateAgent(agent: Agent) {
      const newAgent = { ...agent, id: `ag${Date.now()}`, name: `${agent.name} (Copy)` }
      this.agents.push(newAgent)
      return newAgent
    },

    // Skill CRUD
    saveSkill(data: Skill) {
      const existing = this.skills.find((s) => s.id === data.id)
      if (existing) {
        Object.assign(existing, data)
      } else {
        this.skills.push({ ...data, id: `sk${Date.now()}` })
      }
    },
    deleteSkill(id: string) {
      this.skills = this.skills.filter((s) => s.id !== id)
    },

    // Workflow CRUD
    saveWorkflow(workflow: Workflow) {
      const existing = this.workflows.find((w) => w.id === workflow.id)
      if (existing) {
        Object.assign(existing, workflow)
      } else {
        this.workflows.push({ ...workflow, id: workflow.id || `wf${Date.now()}` })
      }
    },
    updateWorkflowNodes(workflowId: string, nodes: Workflow['nodes']) {
      const wf = this.workflows.find((w) => w.id === workflowId)
      if (wf) wf.nodes = nodes
    },
    updateWorkflowEdges(workflowId: string, edges: Workflow['edges']) {
      const wf = this.workflows.find((w) => w.id === workflowId)
      if (wf) wf.edges = edges
    },
    deleteWorkflow(id: string) {
      this.workflows = this.workflows.filter((w) => w.id !== id)
    },

    renameWorkflow(id: string, name: string) {
      const wf = this.workflows.find((w) => w.id === id)
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

    // MCP Server CRUD
    saveMCPServer(data: MCPServer) {
      const existing = this.mcpServers.find((s) => s.id === data.id)
      if (existing) {
        Object.assign(existing, data)
      } else {
        this.mcpServers.push({ ...data, id: data.id || `mcp${Date.now()}` })
      }
    },
    deleteMCPServer(id: string) {
      this.mcpServers = this.mcpServers.filter((s) => s.id !== id)
    },
    toggleMCPServer(id: string) {
      const s = this.mcpServers.find((x) => x.id === id)
      if (!s) return
      s.enabled = !s.enabled
      if (!s.enabled) {
        s.status = 'disabled'
      } else {
        s.status = s.autoStart ? 'running' : 'idle'
        s.lastError = undefined
      }
    },
    restartMCPServer(id: string) {
      const s = this.mcpServers.find((x) => x.id === id)
      if (!s) return
      s.status = 'starting'
      s.lastError = undefined
      setTimeout(() => {
        const s2 = this.mcpServers.find((x) => x.id === id)
        if (s2) s2.status = 'running'
      }, 800)
    },

    // Hook CRUD
    saveHook(data: Hook) {
      const existing = this.hooks.find((h) => h.id === data.id)
      if (existing) {
        Object.assign(existing, data)
      } else {
        this.hooks.push({ ...data, id: data.id || `hk${Date.now()}` })
      }
    },
    deleteHook(id: string) {
      this.hooks = this.hooks.filter((h) => h.id !== id)
    },
    toggleHook(id: string) {
      const h = this.hooks.find((x) => x.id === id)
      if (h) h.enabled = !h.enabled
    },
    runHookOnce(id: string) {
      const h = this.hooks.find((x) => x.id === id)
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
      const existing = this.commands.find((c) => c.id === data.id)
      if (existing) {
        Object.assign(existing, data)
      } else {
        this.commands.push({ ...data, id: data.id || `cmd${Date.now()}` })
      }
    },
    deleteCommand(id: string) {
      const c = this.commands.find((x) => x.id === id)
      if (c?.system) return
      this.commands = this.commands.filter((x) => x.id !== id)
    },
  },
})
