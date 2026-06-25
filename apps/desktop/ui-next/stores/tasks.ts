import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'

// Tasks store — dual-path live. When the Electron bridge is available
// (`sc.available`) `loadTasks()` pulls the real task list over IPC and a lazy
// `task.*` event subscription keeps it fresh (status / phase / run transitions,
// trace stream, per-run output + discussion). In browser-dev (no shell) it seeds
// a small mock so the Home bento + Tasks page render without the sidecar.
// Mirrors stores/sessions.ts + stores/git.ts dual-path pattern and
// apps/desktop/ui/stores/tasks.ts (reference IPC logic). The full Tasks page
// (pages/tasks.vue) AND the Home dashboard read this slice — the dashboard binds
// `tasks` / `runningTasks` / `awaitingTasks` / `progressOf`, which are preserved
// exactly while richer CRUD + lifecycle is layered alongside (ADR 0024).

// ── Engine shape slice (mirrors sidecar types/shared.ts — only the fields the
// ui-next Tasks page + dashboard bind). NOT imported from the sidecar package. ──

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_connection'
  | 'paused'
  | 'completed'
  | 'failed'

export type PhaseStatus =
  | 'pending'
  | 'running'
  | 'waiting_approval'
  | 'waiting_connection'
  | 'completed'
  | 'failed'

export type RunStatus = 'running' | 'waiting_approval' | 'completed' | 'superseded' | 'failed'

// `connectionId` = the mcpServerId the task uses to reach its source (ADR 0025
// simplified). Optional; never carries a token, only the id.
export type TaskSource =
  | { type: 'github'; repo: string; issueNumber: number; url: string; connectionId?: string }
  | { type: 'jira'; key: string; connectionId?: string }
  | { type: 'manual' }

export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export type TodoItem = { content: string; status: TodoStatus }

// One node in the live execution trace tree (agent / subagent / tool / thinking /
// todo). Mirrors the sidecar TraceNode — recursive via `children`.
export type TraceNode = {
  id: string
  type: 'agent' | 'subagent' | 'tool' | 'thinking' | 'todo'
  name?: string
  model?: string
  purpose?: string
  tool?: string
  input?: string
  result?: string
  text?: string
  agentName?: string
  agentId?: string
  todos?: TodoItem[]
  duration: string | null
  startedAt?: string
  status?: 'running'
  children?: TraceNode[]
}

export type TaskMessage = { role: 'user' | 'agent'; text: string; at: string }

export type TaskRun = {
  version: number
  status: RunStatus
  output: string
  trace: TraceNode[]
  messages: TaskMessage[]
  duration: string | null
  approvedBy?: 'human' | 'auto'
  approvedAt?: string
  triggeredBy?: 'rerun' | 'resume-connection'
}

export type TaskPhase = {
  nodeId: string
  status: PhaseStatus
  skillName: string
  runs: TaskRun[]
}

type WorkflowNodeSlice = {
  id: string
  agentId: string
  agentName?: string
  skillId: string
  approval?: boolean
}

type WorkflowEdgeSlice = { from: string; to: string }

type WorkflowSlice = {
  id: string
  name: string
  nodes: WorkflowNodeSlice[]
  edges?: WorkflowEdgeSlice[]
}

export type Task = {
  id: string
  title: string
  description?: string
  projectId: string
  source?: TaskSource
  workflowId?: string
  status: TaskStatus
  currentNodeId: string | null
  waitingApproval: string | null
  createdAt: string
  commitCoAuthor?: boolean
  workflowSnapshot?: WorkflowSlice
  phases: Record<string, TaskPhase>
}

// Derived per-task progress for the running tile + list item.
export type TaskProgress = {
  pct: number
  doneNodes: number
  totalNodes: number
  currentSkill: string | null
  // agentId of the node currently running (best-effort) — used by the agents tile.
  currentAgentId: string | null
}

// Input from NewTaskModal → createTask.
export type CreateTaskInput = {
  title: string
  description: string
  source: TaskSource
  workflowId: string
  projectId: string
}

// ── Event payload slices (mirrors sidecar types/shared.ts Task*Event) ──

type TaskStatusEvent = { taskId: string; status: TaskStatus; waitingApproval: string | null }
type TaskPhaseStatusEvent = { taskId: string; nodeId: string; status: PhaseStatus }
type TaskRunStartedEvent = {
  taskId: string
  nodeId: string
  version: number
  agentId?: string
  triggeredBy?: TaskRun['triggeredBy']
}
type TaskRunTraceEvent = {
  taskId: string
  nodeId: string
  version: number
  node: TraceNode
  parentId?: string | null
}
type TaskRunOutputEvent = {
  taskId: string
  nodeId: string
  version: number
  delta?: string
  output?: string
}
type TaskRunDoneEvent = {
  taskId: string
  nodeId: string
  version: number
  status: RunStatus
  duration: string | null
  approvedBy?: 'human' | 'auto'
  approvedAt?: string
}
type TaskMessageEvent = { taskId: string; nodeId: string; version: number; message: TaskMessage }

const hasTaskId = (raw: unknown): raw is { taskId: string } =>
  !!raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).taskId === 'string'

// ── Trace tree upsert (mirror sidecar tasks/store.ts) ───────────────────────

function replaceTraceById(list: TraceNode[], node: TraceNode): boolean {
  for (let i = 0; i < list.length; i += 1) {
    const cur = list[i]
    if (!cur) continue
    if (cur.id === node.id) {
      const merged: TraceNode = { ...node }
      if (cur.children) merged.children = cur.children
      list.splice(i, 1, merged)
      return true
    }
    if (cur.children && replaceTraceById(cur.children, node)) return true
  }
  return false
}

function findTraceById(list: TraceNode[], id: string): TraceNode | null {
  let found: TraceNode | null = null
  list.some((cur) => {
    if (cur.id === id) {
      found = cur
      return true
    }
    if (cur.children) {
      const hit = findTraceById(cur.children, id)
      if (hit) {
        found = hit
        return true
      }
    }
    return false
  })
  return found
}

function upsertTrace(trace: TraceNode[], node: TraceNode, parentId?: string | null): void {
  if (replaceTraceById(trace, node)) return
  if (parentId) {
    const parent = findTraceById(trace, parentId)
    if (parent) {
      parent.children = parent.children ?? []
      parent.children.push(node)
      return
    }
  }
  trace.push(node)
}

// Topological order of the DAG so the pipeline renders source → sink. Falls back
// to the node array order when there are no edges (single-node / linear workflow).
function topoOrder(nodes: WorkflowNodeSlice[], edges: WorkflowEdgeSlice[]): string[] {
  const ids = nodes.map((n) => n.id)
  if (!edges.length) return ids
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]))
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const e of edges) {
    if (!adj.has(e.from) || !indegree.has(e.to)) continue
    adj.get(e.from)!.push(e.to)
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1)
  }
  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const next of adj.get(id) ?? []) {
      const deg = (indegree.get(next) ?? 0) - 1
      indegree.set(next, deg)
      if (deg === 0) queue.push(next)
    }
  }
  // Cycle guard: append any node the sort missed so nothing disappears.
  for (const id of ids) if (!order.includes(id)) order.push(id)
  return order
}

const nowIso = (): string => new Date().toISOString()

// Mock seed (browser-dev): one running task, one second running, one awaiting
// approval, one done — so both the Tasks page (master-detail) and the Home bento
// have data without the engine. Runs carry trace + output so the detail renders.
function mockTasks(): Task[] {
  return [
    {
      id: 'tsk-mock-1',
      title: 'Lazy-load transcripts (ADR 0048)',
      description: 'Stream session JSONL on open instead of eager full load.',
      projectId: 'awog',
      source: { type: 'manual' },
      workflowId: 'wf-1',
      status: 'running',
      currentNodeId: 'n3',
      waitingApproval: null,
      createdAt: new Date(Date.now() - 4 * 60_000).toISOString(),
      workflowSnapshot: {
        id: 'wf-1',
        name: 'tech-lead → developer → qa',
        nodes: [
          { id: 'n1', agentId: 'tech-lead', agentName: 'tech-lead', skillId: 'write-adr' },
          { id: 'n2', agentId: 'tech-lead', agentName: 'tech-lead', skillId: 'write-adr' },
          {
            id: 'n3',
            agentId: 'developer',
            agentName: 'developer',
            skillId: 'implement-feature',
          },
          {
            id: 'n4',
            agentId: 'developer',
            agentName: 'developer',
            skillId: 'implement-feature',
          },
          { id: 'n5', agentId: 'qa-tester', agentName: 'qa-tester', skillId: 'write-test-cases' },
        ],
        edges: [
          { from: 'n1', to: 'n2' },
          { from: 'n2', to: 'n3' },
          { from: 'n3', to: 'n4' },
          { from: 'n4', to: 'n5' },
        ],
      },
      phases: {
        n1: {
          nodeId: 'n1',
          status: 'completed',
          skillName: 'write-adr',
          runs: mockDoneRuns('38s'),
        },
        n2: {
          nodeId: 'n2',
          status: 'completed',
          skillName: 'write-adr',
          runs: mockDoneRuns('1m 04s'),
        },
        n3: {
          nodeId: 'n3',
          status: 'running',
          skillName: 'implement-feature',
          runs: mockRunningRuns(),
        },
        n4: { nodeId: 'n4', status: 'pending', skillName: 'implement-feature', runs: [] },
        n5: { nodeId: 'n5', status: 'pending', skillName: 'write-test-cases', runs: [] },
      },
    },
    {
      id: 'tsk-mock-2',
      title: 'Audit fs.* path sanitize',
      description: 'Verify path traversal guards on every workspace I/O sink.',
      projectId: 'awog',
      source: { type: 'manual' },
      workflowId: 'wf-2',
      status: 'running',
      currentNodeId: 'n1',
      waitingApproval: null,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      workflowSnapshot: {
        id: 'wf-2',
        name: 'infosec',
        nodes: [{ id: 'n1', agentId: 'infosec', agentName: 'infosec', skillId: 'security-audit' }],
      },
      phases: {
        n1: {
          nodeId: 'n1',
          status: 'running',
          skillName: 'security-audit',
          runs: mockRunningRuns(),
        },
      },
    },
    {
      id: 'tsk-mock-3',
      title: 'Wire enhance-prompt method',
      description: 'Add the sessions.enhancePrompt RPC + composer wiring.',
      projectId: 'awog',
      source: { type: 'github', repo: 'kyro/awog', issueNumber: 142, url: '' },
      workflowId: 'wf-3',
      status: 'waiting_approval',
      currentNodeId: 'n2',
      waitingApproval: 'n2',
      createdAt: new Date(Date.now() - 9 * 60_000).toISOString(),
      workflowSnapshot: {
        id: 'wf-3',
        name: 'developer',
        nodes: [
          {
            id: 'n1',
            agentId: 'developer',
            agentName: 'developer',
            skillId: 'implement-feature',
          },
          {
            id: 'n2',
            agentId: 'developer',
            agentName: 'developer',
            skillId: 'implement-feature',
            approval: true,
          },
        ],
        edges: [{ from: 'n1', to: 'n2' }],
      },
      phases: {
        n1: {
          nodeId: 'n1',
          status: 'completed',
          skillName: 'implement-feature',
          runs: mockDoneRuns('22s'),
        },
        n2: {
          nodeId: 'n2',
          status: 'waiting_approval',
          skillName: 'implement-feature',
          runs: mockApprovalRuns(),
        },
      },
    },
    {
      id: 'tsk-mock-4',
      title: 'Redesign Git reference UI',
      description: 'Sublime-Merge style sidebar + flat default surfaces.',
      projectId: 'awog',
      source: { type: 'manual' },
      workflowId: 'wf-4',
      status: 'completed',
      currentNodeId: null,
      waitingApproval: null,
      createdAt: new Date(Date.now() - 40 * 60_000).toISOString(),
      workflowSnapshot: {
        id: 'wf-4',
        name: 'tech-lead → developer → reviewer',
        nodes: [
          { id: 'n1', agentId: 'tech-lead', agentName: 'tech-lead', skillId: 'write-adr' },
          {
            id: 'n2',
            agentId: 'developer',
            agentName: 'developer',
            skillId: 'implement-feature',
          },
          { id: 'n3', agentId: 'code-reviewer', agentName: 'code-reviewer', skillId: 'review-pr' },
        ],
        edges: [
          { from: 'n1', to: 'n2' },
          { from: 'n2', to: 'n3' },
        ],
      },
      phases: {
        n1: {
          nodeId: 'n1',
          status: 'completed',
          skillName: 'write-adr',
          runs: mockDoneRuns('40s'),
        },
        n2: {
          nodeId: 'n2',
          status: 'completed',
          skillName: 'implement-feature',
          runs: mockDoneRuns('6m'),
        },
        n3: { nodeId: 'n3', status: 'completed', skillName: 'review-pr', runs: mockDoneRuns('1m') },
      },
    },
  ]
}

function mockDoneRuns(duration: string): TaskRun[] {
  return [
    {
      version: 1,
      status: 'completed',
      output: '✓ Done. Committed and verified.',
      trace: [
        {
          id: 'tr-1',
          type: 'agent',
          name: 'agent',
          model: 'Opus 4.8',
          duration,
          children: [
            { id: 'tr-1-1', type: 'tool', tool: 'Read', input: 'types/index.ts', duration: '0.4s' },
            {
              id: 'tr-1-2',
              type: 'tool',
              tool: 'Edit',
              input: 'types/index.ts',
              result: '+12 −0',
              duration: '0.6s',
            },
          ],
        },
      ],
      messages: [],
      duration,
      approvedBy: 'auto',
    },
  ]
}

function mockRunningRuns(): TaskRun[] {
  return [
    {
      version: 1,
      status: 'running',
      output: '',
      trace: [
        {
          id: 'tr-live',
          type: 'agent',
          name: 'agent',
          model: 'Opus 4.8',
          duration: null,
          status: 'running',
          children: [
            {
              id: 'tr-live-1',
              type: 'tool',
              tool: 'Grep',
              input: '"path.join"',
              result: '18 matches',
              duration: '0.3s',
            },
          ],
        },
      ],
      messages: [],
      duration: null,
    },
  ]
}

function mockApprovalRuns(): TaskRun[] {
  return [
    {
      version: 1,
      status: 'waiting_approval',
      output: '⏸ Waiting for approval: writeFile methods/sessions.enhance-prompt.ts',
      trace: [
        {
          id: 'tr-appr',
          type: 'agent',
          name: 'developer',
          model: 'Opus 4.8',
          duration: '50s',
        },
      ],
      messages: [],
      duration: '50s',
    },
  ]
}

export const useTasksStore = defineStore('tasks', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const tasks = ref<Task[]>(sc.available ? [] : mockTasks())
  const loaded = ref(false)
  const selectedTaskId = ref<string | null>(sc.available ? null : (mockTasks()[0]?.id ?? null))

  let unlisten: UnlistenFn | null = null

  // ── Getters (dashboard-compat surface — DO NOT rename) ──────────────────────

  const runningTasks = computed<Task[]>(() => tasks.value.filter((t) => t.status === 'running'))
  const awaitingTasks = computed<Task[]>(() =>
    tasks.value.filter((t) => t.status === 'waiting_approval'),
  )
  const selectedTask = computed<Task | null>(
    () => tasks.value.find((t) => t.id === selectedTaskId.value) ?? null,
  )
  const taskById = (id: string): Task | undefined => tasks.value.find((t) => t.id === id)

  // Per-task DAG progress. % = completed phases / total nodes. `currentSkill` and
  // `currentAgentId` come from the first running phase (parallel scheduler may run
  // several; the first is good enough for a one-line tile). Dashboard binds this.
  function progressOf(task: Task): TaskProgress {
    const nodes = task.workflowSnapshot?.nodes ?? []
    const totalNodes = nodes.length || Object.keys(task.phases).length
    const phases = Object.values(task.phases)
    const doneNodes = phases.filter((p) => p.status === 'completed').length
    const pct = totalNodes > 0 ? Math.round((doneNodes / totalNodes) * 100) : 0
    const runningPhase = phases.find((p) => p.status === 'running')
    const currentSkill = runningPhase?.skillName ?? null
    const currentAgentId =
      nodes.find((n) => n.id === (runningPhase?.nodeId ?? task.currentNodeId))?.agentId ?? null
    return { pct, doneNodes, totalNodes, currentSkill, currentAgentId }
  }

  // Topological pipeline order for a task's DAG (detail view renders phases in
  // this order). Falls back to the phases keys when no snapshot exists.
  function phaseOrder(task: Task): string[] {
    const wf = task.workflowSnapshot
    if (!wf) return Object.keys(task.phases)
    return topoOrder(wf.nodes, wf.edges ?? [])
  }

  function nodeFor(task: Task, nodeId: string): WorkflowNodeSlice | undefined {
    return task.workflowSnapshot?.nodes.find((n) => n.id === nodeId)
  }

  // ── Load (IPC) ──────────────────────────────────────────────────────────────

  async function loadTasks(): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    try {
      const res = await sc.request<{ tasks: Task[] }>('tasks.list', {})
      tasks.value = Array.isArray(res.tasks) ? res.tasks : []
      if (selectedTaskId.value == null) selectedTaskId.value = tasks.value[0]?.id ?? null
    } catch (err) {
      console.warn('[tasks] loadTasks failed', err)
    } finally {
      loaded.value = true
      void subscribe()
    }
  }

  function selectTask(id: string | null): void {
    selectedTaskId.value = id
  }

  // ── Event subscription (lazy app-lifetime; first loadTasks wires it once) ─────

  async function subscribe(): Promise<void> {
    if (!available.value || unlisten) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (!evt || typeof evt.type !== 'string') return
        if (!evt.type.startsWith('task.')) return
        if (!hasTaskId(evt.payload)) return
        routeEvent(evt.type, evt.payload)
      })
    } catch {
      // Browser-dev: onEvent throws when the bridge is absent. Ignore (mock path).
      unlisten = null
    }
  }

  function routeEvent(type: string, payload: unknown): void {
    switch (type) {
      case 'task.status':
        applyStatus(payload as TaskStatusEvent)
        break
      case 'task.phase.status':
        applyPhaseStatus(payload as TaskPhaseStatusEvent)
        break
      case 'task.run.started':
        applyRunStarted(payload as TaskRunStartedEvent)
        break
      case 'task.run.trace':
        applyRunTrace(payload as TaskRunTraceEvent)
        break
      case 'task.run.output':
        applyRunOutput(payload as TaskRunOutputEvent)
        break
      case 'task.run.done':
        applyRunDone(payload as TaskRunDoneEvent)
        break
      case 'task.message':
        applyMessage(payload as TaskMessageEvent)
        break
      default:
        break
    }
  }

  function applyStatus(e: TaskStatusEvent): void {
    const task = taskById(e.taskId)
    if (task) {
      task.status = e.status
      task.waitingApproval = e.waitingApproval
    } else {
      // A brand-new task we haven't seen — reload the list once.
      void loadTasks()
    }
  }

  function applyPhaseStatus(e: TaskPhaseStatusEvent): void {
    const phase = taskById(e.taskId)?.phases[e.nodeId]
    if (phase) phase.status = e.status
  }

  function applyRunStarted(e: TaskRunStartedEvent): void {
    const task = taskById(e.taskId)
    const phase = task?.phases[e.nodeId]
    if (!task || !phase) return
    task.currentNodeId = e.nodeId
    // Supersede prior completed/awaiting runs when this is a rerun.
    if (e.triggeredBy === 'rerun') {
      phase.runs = phase.runs.map((r) =>
        r.status === 'completed' || r.status === 'waiting_approval'
          ? { ...r, status: 'superseded' as const }
          : r,
      )
    }
    if (phase.runs.some((r) => r.version === e.version)) return
    const run: TaskRun = {
      version: e.version,
      status: 'running',
      output: '',
      trace: [],
      messages: [],
      duration: null,
    }
    if (e.triggeredBy) run.triggeredBy = e.triggeredBy
    phase.runs.push(run)
  }

  function findRun(taskId: string, nodeId: string, version: number): TaskRun | undefined {
    const phase = taskById(taskId)?.phases[nodeId]
    return phase?.runs.find((r) => r.version === version)
  }

  function applyRunTrace(e: TaskRunTraceEvent): void {
    const run = findRun(e.taskId, e.nodeId, e.version)
    if (run) upsertTrace(run.trace, e.node, e.parentId)
  }

  function applyRunOutput(e: TaskRunOutputEvent): void {
    const run = findRun(e.taskId, e.nodeId, e.version)
    if (!run) return
    if (typeof e.output === 'string') run.output = e.output
    else if (typeof e.delta === 'string') run.output += e.delta
  }

  function applyRunDone(e: TaskRunDoneEvent): void {
    const run = findRun(e.taskId, e.nodeId, e.version)
    if (!run) return
    run.status = e.status
    run.duration = e.duration
    if (e.approvedBy) run.approvedBy = e.approvedBy
    if (e.approvedAt) run.approvedAt = e.approvedAt
  }

  function applyMessage(e: TaskMessageEvent): void {
    const run = findRun(e.taskId, e.nodeId, e.version)
    if (run) run.messages.push(e.message)
  }

  // ── Commands (optimistic + RPC; browser-dev keeps mock optimism) ─────────────

  // Fire-and-forget persistence/command helper. UI state stays optimistic — the
  // authoritative task.* events overwrite it as the engine runs.
  function push(method: string, params: unknown): void {
    if (!available.value) return
    sc.request(method, params).catch((err) => console.warn(`[tasks] ${method} failed`, err))
  }

  // Create a task. The engine snapshots the workflow + seeds phases and kicks off
  // execution; in browser-dev we synthesize the snapshot/phases locally so the
  // detail view renders. Returns the created task (or undefined when create is
  // blocked — never in practice). `workflowName` is a display label the caller
  // resolves from its already-loaded workflow list (the store has no workflows
  // store dep — SoC).
  function createTask(
    data: CreateTaskInput,
    snapshot?: WorkflowSlice,
    commitCoAuthor = true,
  ): Task {
    const id = `tsk-${Date.now().toString(36)}`
    const phases: Record<string, TaskPhase> = {}
    const nodes = snapshot?.nodes ?? []
    for (const n of nodes) {
      phases[n.id] = {
        nodeId: n.id,
        status: 'pending',
        skillName: n.skillId || 'unknown',
        runs: [],
      }
    }
    const task: Task = {
      id,
      title: data.title,
      description: data.description,
      projectId: data.projectId,
      source: data.source,
      workflowId: data.workflowId,
      status: 'queued',
      currentNodeId: null,
      waitingApproval: null,
      createdAt: nowIso(),
      commitCoAuthor,
      phases,
    }
    if (snapshot) task.workflowSnapshot = snapshot
    tasks.value.unshift(task)
    selectedTaskId.value = id
    push('tasks.create', {
      id,
      title: data.title,
      projectId: data.projectId,
      source: data.source,
      description: data.description,
      workflowId: data.workflowId,
      commitCoAuthor,
    })
    return task
  }

  function approvePhase(taskId: string, nodeId: string): void {
    const task = taskById(taskId)
    const phase = task?.phases[nodeId]
    if (!task || !phase) return
    // Optimistic: mark approved + completed. The engine confirms downstream
    // activation via task.* events.
    phase.status = 'completed'
    const last = phase.runs[phase.runs.length - 1]
    if (last) {
      last.status = 'completed'
      last.approvedBy = 'human'
      last.approvedAt = nowIso()
    }
    task.waitingApproval = null
    push('tasks.approvePhase', { taskId, nodeId })
    if (!available.value) simulateAdvance(taskId, nodeId)
  }

  function rerunPhase(taskId: string, nodeId: string, instruction = ''): void {
    const task = taskById(taskId)
    const phase = task?.phases[nodeId]
    if (!task || !phase) return
    // Optimistic supersede of THIS phase's prior runs + restart it; the engine
    // recomputes the authoritative downstream supersede.
    const nextVersion = (phase.runs[phase.runs.length - 1]?.version ?? 0) + 1
    phase.runs = phase.runs.map((r) =>
      r.status === 'completed' || r.status === 'waiting_approval'
        ? { ...r, status: 'superseded' as const }
        : r,
    )
    phase.runs.push({
      version: nextVersion,
      status: 'running',
      output: '',
      trace: [],
      messages: instruction ? [{ role: 'user', text: instruction, at: nowIso() }] : [],
      duration: null,
      triggeredBy: 'rerun',
    })
    phase.status = 'running'
    task.status = 'running'
    task.waitingApproval = null
    push('tasks.rerunPhase', instruction ? { taskId, nodeId, instruction } : { taskId, nodeId })
  }

  function discussPhase(taskId: string, nodeId: string, runVersion: number, text: string): void {
    const run = findRun(taskId, nodeId, runVersion)
    if (!run) return
    run.messages.push({ role: 'user', text, at: nowIso() })
    if (available.value) {
      push('tasks.discuss', { taskId, nodeId, runVersion, text })
    } else {
      // Browser-dev: canned agent acknowledgement so the discussion tab animates.
      setTimeout(() => {
        const r2 = findRun(taskId, nodeId, runVersion)
        if (r2)
          r2.messages.push({
            role: 'agent',
            text: 'Understood. I will incorporate this feedback when you trigger a rerun.',
            at: nowIso(),
          })
      }, 1200)
    }
  }

  // Abort a running/queued task. Engine aborts in-flight nodes → emits the failed
  // transitions; we optimistically reflect 'failed' for browser-dev.
  function cancelTask(id: string): void {
    const task = taskById(id)
    if (task && !available.value) {
      task.status = 'failed'
      task.waitingApproval = null
    }
    push('tasks.cancel', { id })
  }

  // Pause: stop scheduling new nodes (in-flight finish). Transitions to 'paused'
  // once the engine drains in-flight work (via task.status event).
  function pauseTask(id: string): void {
    const task = taskById(id)
    if (task && !available.value) task.status = 'paused'
    push('tasks.pause', { id })
  }

  function resumeTask(id: string): void {
    const task = taskById(id)
    if (task && !available.value) task.status = 'running'
    push('tasks.resume', { id })
  }

  function renameTask(id: string, title: string): void {
    const task = taskById(id)
    if (task && title.trim()) task.title = title.trim()
    push('tasks.rename', { id, title })
  }

  function deleteTask(id: string): void {
    tasks.value = tasks.value.filter((t) => t.id !== id)
    if (selectedTaskId.value === id) selectedTaskId.value = tasks.value[0]?.id ?? null
    push('tasks.delete', { id })
  }

  // ── Browser-dev simulation (no shell) ────────────────────────────────────────
  // Activate the next pending phase so the mock pipeline animates after approve.
  function simulateAdvance(taskId: string, nodeId: string): void {
    const task = taskById(taskId)
    if (!task) return
    const order = phaseOrder(task)
    const idx = order.indexOf(nodeId)
    const nextNodeId = idx >= 0 && idx < order.length - 1 ? (order[idx + 1] ?? null) : null
    task.status = nextNodeId ? 'running' : 'completed'
    if (!nextNodeId) return
    setTimeout(() => {
      const nextPhase = taskById(taskId)?.phases[nextNodeId]
      if (nextPhase && nextPhase.status === 'pending') {
        nextPhase.status = 'running'
        nextPhase.runs = mockRunningRuns()
      }
    }, 600)
  }

  return {
    // state
    tasks,
    loaded,
    available,
    selectedTaskId,
    // getters
    runningTasks,
    awaitingTasks,
    selectedTask,
    taskById,
    progressOf,
    phaseOrder,
    nodeFor,
    findRun,
    // load + selection
    loadTasks,
    selectTask,
    // commands
    createTask,
    approvePhase,
    rerunPhase,
    discussPhase,
    cancelTask,
    pauseTask,
    resumeTask,
    renameTask,
    deleteTask,
  }
})
