import { defineStore, acceptHMRUpdate } from 'pinia'
import type {
  Run,
  Task,
  TaskSource,
  TraceNode,
  TaskStatusEvent,
  TaskPhaseStatusEvent,
  TaskRunStartedEvent,
  TaskRunTraceEvent,
  TaskRunOutputEvent,
  TaskRunDoneEvent,
  TaskMessageEvent,
} from '~/types'
import { useWorkflowsStore } from '~/stores/workflows'
import { useWorkspaceStore } from '~/stores/workspace'
import { topoSort } from '~/utils/graph'
import { INITIAL_TASKS } from '~/utils/initial-data'
import { makeLiveTrace, makeTrace, mockOutput } from '~/utils/mock-output'
import { nowIso } from '~/utils/time'

interface CreateTaskInput {
  title: string
  description: string
  source: TaskSource
  workflowId: string
  projectId: string
}

interface TasksListResponse {
  tasks: Task[]
}

type PhaseTab = 'output' | 'trace' | 'discuss'
// Per-phase view state (which phase card is expanded + its active tab). Lives in the
// store, not component-local refs, so it survives navigating to the fullscreen artifact
// editor (/edit/:taskId) and back — that route uses a different layout, so the tasks page
// unmounts and component-local state would reset. Fields optional: absent → fall back to
// the natural default in PhaseCard (running phases auto-expand, tab defaults to 'output').
type PhaseUiState = { expanded?: boolean; tab?: PhaseTab }

// Fire-and-forget persistence/command helper. UI state stays optimistic — the
// authoritative task.* events overwrite it as the engine runs.
const pushToSidecar = (method: string, params: unknown): void => {
  const sidecar = useSidecar()
  if (!sidecar.available) return
  sidecar.request(method, params).catch((err) => {
    console.warn(`[tasks] ${method} failed:`, err)
  })
}

// ─── Trace tree upsert (mirror sidecar tasks/store.ts) ───────────────────────

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

// ─── Event type guards ───────────────────────────────────────────────────────

const hasTaskId = (raw: unknown): raw is { taskId: string } =>
  !!raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).taskId === 'string'

export const useTasksStore = defineStore('tasks', {
  state: () => ({
    tasks: [] as Task[],
    selectedTaskId: null as string | null,
    hydrated: false,
    // Detail-view UI state, persisted across the round-trip to the artifact editor.
    phaseUi: {} as Record<string, PhaseUiState>, // key: `${taskId}:${nodeId}`
    detailScroll: {} as Record<string, number>, // key: taskId → scrollTop
  }),

  getters: {
    selectedTask(state): Task | undefined {
      return state.tasks.find((t) => t.id === state.selectedTaskId)
    },
    // Number of tasks currently executing — drives the live `•N` badge on the
    // Tasks tab in the header so running work is visible without opening it.
    runningCount(state): number {
      return state.tasks.filter((t) => t.status === 'running').length
    },
    taskById:
      (state) =>
      (id: string): Task | undefined =>
        state.tasks.find((t) => t.id === id),
    // Parallel scheduler can leave >1 phase running — derive the set from phase
    // status instead of relying on the singular currentNodeId (ADR 0024).
    runningPhaseIds:
      (state) =>
      (taskId: string): string[] => {
        const task = state.tasks.find((t) => t.id === taskId)
        if (!task) return []
        return Object.values(task.phases)
          .filter((p) => p.status === 'running')
          .map((p) => p.nodeId)
      },
    phaseUiFor:
      (state) =>
      (taskId: string, nodeId: string): PhaseUiState | undefined =>
        state.phaseUi[`${taskId}:${nodeId}`],
    detailScrollFor:
      (state) =>
      (taskId: string): number =>
        state.detailScroll[taskId] ?? 0,
  },

  actions: {
    async hydrateFromSidecar(): Promise<void> {
      if (this.hydrated) return
      const sidecar = useSidecar()
      if (!sidecar.available) {
        // Browser-dev: seed mock so the list/detail is browsable without Tauri.
        if (!this.tasks.length) this.tasks = [...INITIAL_TASKS]
        this.selectedTaskId = this.tasks[0]?.id ?? null
        this.hydrated = true
        return
      }
      try {
        const res = await sidecar.request<TasksListResponse>('tasks.list')
        this.tasks = res.tasks ?? []
        this.selectedTaskId = this.tasks[0]?.id ?? null
        this.hydrated = true
      } catch (err) {
        console.warn('[tasks] hydrate failed:', err)
      }
    },

    // App-lifetime event listener (registered once in app.vue). Tasks run in the
    // background and survive navigation, so this is NOT per-send like sessions.
    // Returns an unsubscribe fn.
    async subscribe(): Promise<() => void> {
      const sidecar = useSidecar()
      if (!sidecar.available) return () => {}
      try {
        const unlisten = await sidecar.onEvent((evt) => {
          if (!evt || typeof evt.type !== 'string') return
          if (!evt.type.startsWith('task.')) return
          this.routeEvent(evt.type, evt.payload)
        })
        return unlisten
      } catch {
        return () => {}
      }
    },

    routeEvent(type: string, payload: unknown): void {
      if (!hasTaskId(payload)) return
      switch (type) {
        case 'task.status':
          this.applyStatus(payload as TaskStatusEvent)
          break
        case 'task.phase.status':
          this.applyPhaseStatus(payload as TaskPhaseStatusEvent)
          break
        case 'task.run.started':
          this.applyRunStarted(payload as TaskRunStartedEvent)
          break
        case 'task.run.trace':
          this.applyRunTrace(payload as TaskRunTraceEvent)
          break
        case 'task.run.output':
          this.applyRunOutput(payload as TaskRunOutputEvent)
          break
        case 'task.run.done':
          this.applyRunDone(payload as TaskRunDoneEvent)
          break
        case 'task.message':
          this.applyMessage(payload as TaskMessageEvent)
          break
        default:
          break
      }
    },

    applyStatus(e: TaskStatusEvent): void {
      const task = this.tasks.find((t) => t.id === e.taskId)
      if (!task) return
      task.status = e.status
      task.waitingApproval = e.waitingApproval
    },

    applyPhaseStatus(e: TaskPhaseStatusEvent): void {
      const phase = this.tasks.find((t) => t.id === e.taskId)?.phases[e.nodeId]
      if (phase) phase.status = e.status
    },

    applyRunStarted(e: TaskRunStartedEvent): void {
      const phase = this.tasks.find((t) => t.id === e.taskId)?.phases[e.nodeId]
      if (!phase) return
      // Supersede prior completed runs when this is a rerun.
      if (e.triggeredBy === 'rerun') {
        phase.runs = phase.runs.map((r) =>
          r.status === 'completed' || r.status === 'waiting_approval'
            ? { ...r, status: 'superseded' as const }
            : r,
        )
      }
      if (phase.runs.some((r) => r.version === e.version)) return
      const run: Run = {
        version: e.version,
        status: 'running',
        output: '',
        trace: [],
        messages: [],
        duration: null,
      }
      if (e.triggeredBy) run.triggeredBy = e.triggeredBy
      phase.runs.push(run)
    },

    applyRunTrace(e: TaskRunTraceEvent): void {
      const run = this.findRun(e.taskId, e.nodeId, e.version)
      if (run) upsertTrace(run.trace, e.node, e.parentId)
    },

    applyRunOutput(e: TaskRunOutputEvent): void {
      const run = this.findRun(e.taskId, e.nodeId, e.version)
      if (!run) return
      if (typeof e.output === 'string') run.output = e.output
      else if (typeof e.delta === 'string') run.output += e.delta
    },

    applyRunDone(e: TaskRunDoneEvent): void {
      const run = this.findRun(e.taskId, e.nodeId, e.version)
      if (!run) return
      run.status = e.status
      run.duration = e.duration
      if (e.approvedBy) run.approvedBy = e.approvedBy
      if (e.approvedAt) run.approvedAt = e.approvedAt
    },

    applyMessage(e: TaskMessageEvent): void {
      const run = this.findRun(e.taskId, e.nodeId, e.version)
      if (run) run.messages.push(e.message)
    },

    findRun(taskId: string, nodeId: string, version: number): Run | undefined {
      const phase = this.tasks.find((t) => t.id === taskId)?.phases[nodeId]
      return phase?.runs.find((r) => r.version === version)
    },

    // ─── Commands (optimistic + RPC, with browser-dev simulation) ───────────

    selectTask(id: string | null): void {
      this.selectedTaskId = id
    },

    // Merge a partial UI patch (expanded and/or tab) for one phase card.
    setPhaseUi(taskId: string, nodeId: string, patch: PhaseUiState): void {
      const key = `${taskId}:${nodeId}`
      this.phaseUi[key] = { ...(this.phaseUi[key] ?? {}), ...patch }
    },

    setDetailScroll(taskId: string, top: number): void {
      this.detailScroll[taskId] = top
    },

    deleteTask(id: string): void {
      this.tasks = this.tasks.filter((t) => t.id !== id)
      if (this.selectedTaskId === id) this.selectedTaskId = this.tasks[0]?.id ?? null
      pushToSidecar('tasks.delete', { id })
    },

    // Abort a running/queued task. Engine aborts in-flight nodes → emits the
    // failed transitions; we optimistically reflect 'failed' for browser-dev.
    cancelTask(id: string): void {
      const task = this.tasks.find((t) => t.id === id)
      if (task && !useSidecar().available) {
        task.status = 'failed'
        task.waitingApproval = null
      }
      pushToSidecar('tasks.cancel', { id })
    },

    // Pause: stop scheduling new nodes (in-flight finish). The task transitions
    // to 'paused' once the engine drains in-flight work (via task.status event).
    pauseTask(id: string): void {
      const task = this.tasks.find((t) => t.id === id)
      if (task && !useSidecar().available) task.status = 'paused'
      pushToSidecar('tasks.pause', { id })
    },

    resumeTask(id: string): void {
      const task = this.tasks.find((t) => t.id === id)
      if (task && !useSidecar().available) task.status = 'running'
      pushToSidecar('tasks.resume', { id })
    },

    renameTask(id: string, title: string): void {
      const task = this.tasks.find((t) => t.id === id)
      if (task) task.title = title
      pushToSidecar('tasks.rename', { id, title })
    },

    createTask(data: CreateTaskInput): Task | undefined {
      const wf = useWorkflowsStore().workflowById(data.workflowId)
      if (!wf) return undefined
      const { skills } = useWorkspaceStore()
      const phases: Task['phases'] = {}
      wf.nodes.forEach((n) => {
        const sk = skills.find((s) => s.id === n.skillId)
        phases[n.id] = {
          nodeId: n.id,
          status: 'pending',
          skillName: sk?.name || n.skillId || 'unknown',
          runs: [],
        }
      })
      const id = `tsk-${Date.now().toString(36)}`
      const task: Task = {
        id,
        title: data.title,
        description: data.description,
        source: data.source,
        projectId: data.projectId,
        workflowId: data.workflowId,
        status: 'queued',
        currentNodeId: null,
        waitingApproval: null,
        waitingConnection: null,
        createdAt: nowIso(),
        phases,
      }
      this.tasks.unshift(task)
      this.selectedTaskId = id
      pushToSidecar('tasks.create', {
        id,
        title: data.title,
        projectId: data.projectId,
        source: data.source,
        description: data.description,
        workflowId: data.workflowId,
      })
      return task
    },

    approvePhase(taskId: string, nodeId: string): void {
      const task = this.tasks.find((t) => t.id === taskId)
      if (!task) return
      const phase = task.phases[nodeId]
      if (!phase) return
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

      if (useSidecar().available) {
        pushToSidecar('tasks.approvePhase', { taskId, nodeId })
      } else {
        this.simulateApprove(taskId, nodeId)
      }
    },

    rerunFromPhase(taskId: string, nodeId: string, instruction: string): void {
      const task = this.tasks.find((t) => t.id === taskId)
      if (!task) return
      const wf = task.workflowSnapshot ?? useWorkflowsStore().workflowById(task.workflowId)
      if (!wf) return

      // Optimistic supersede of downstream runs (reachability via topo slice is
      // good enough for the optimistic view; the engine recomputes authoritatively).
      const order = topoSort(wf.nodes, wf.edges)
      const startIdx = order.indexOf(nodeId)
      const downstream = order.slice(startIdx)
      downstream.forEach((nid, i) => {
        const phase = task.phases[nid]
        if (!phase) return
        if (i === 0) {
          const nextVersion = (phase.runs[phase.runs.length - 1]?.version || 0) + 1
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
        } else {
          phase.runs = phase.runs.map((r) => ({ ...r, status: 'superseded' as const }))
          phase.status = 'pending'
        }
      })
      task.status = 'running'
      task.waitingApproval = null

      if (useSidecar().available) {
        pushToSidecar('tasks.rerunPhase', { taskId, nodeId, instruction })
      } else {
        this.simulateRerun(taskId, nodeId)
      }
    },

    sendMessageToPhase(taskId: string, nodeId: string, runVersion: number, text: string): void {
      const run = this.findRun(taskId, nodeId, runVersion)
      if (!run) return
      run.messages.push({ role: 'user', text, at: nowIso() })

      if (useSidecar().available) {
        pushToSidecar('tasks.discuss', { taskId, nodeId, runVersion, text })
      } else {
        setTimeout(() => {
          const r2 = this.findRun(taskId, nodeId, runVersion)
          if (r2) {
            r2.messages.push({
              role: 'agent',
              text: 'Understood. I will incorporate this feedback when you trigger a rerun.',
              at: nowIso(),
            })
          }
        }, 1500)
      }
    },

    // ─── Browser-dev simulations (no Tauri) ─────────────────────────────────
    // Kept so the prototype animates without a sidecar. Never run in the live
    // path (guarded by useSidecar().available above).

    simulateRerun(taskId: string, nodeId: string): void {
      const wf = this.tasks.find((t) => t.id === taskId)?.workflowSnapshot
      const node = wf?.nodes.find((n) => n.id === nodeId)
      setTimeout(() => {
        const task = this.tasks.find((t) => t.id === taskId)
        const phase = task?.phases[nodeId]
        const latest = phase?.runs[phase.runs.length - 1]
        if (!task || !phase || !latest) return
        const needsApproval = node?.approval ?? false
        latest.status = needsApproval ? 'waiting_approval' : 'completed'
        latest.output = mockOutput(phase.skillName)
        latest.trace = makeTrace(node?.agentId ?? '', 'review' as never)
        latest.duration = '38s'
        phase.status = needsApproval ? 'waiting_approval' : 'completed'
        if (needsApproval) {
          task.status = 'waiting_approval'
          task.waitingApproval = nodeId
        }
      }, 3000)
    },

    simulateApprove(taskId: string, nodeId: string): void {
      const task = this.tasks.find((t) => t.id === taskId)
      const wf = task?.workflowSnapshot ?? useWorkflowsStore().workflowById(task?.workflowId ?? '')
      if (!task || !wf) return
      const order = topoSort(wf.nodes, wf.edges)
      const idx = order.indexOf(nodeId)
      const nextNodeId = idx === order.length - 1 ? null : (order[idx + 1] ?? null)
      task.status = nextNodeId ? 'running' : 'completed'
      if (!nextNodeId) return
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
    },
  },
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTasksStore, import.meta.hot))
}
