// Task Execution Engine (ADR 0024). Owns the live-task runtime registry, the
// parallel scheduler loop, and the public lifecycle API the tasks.* methods +
// boot call. Pure DAG math lives in scheduler.ts; per-node work in node-runner.ts;
// persistence+emit in emit.ts/store.ts.
//
// Concurrency model (D-1): a node runs when all upstream phases are completed;
// up to CONCURRENCY_CAP nodes run at once per task. Schedule calls are serialised
// per task (a single loop drains a "rescan requested" flag) so two completions
// can't double-dispatch a node.

import { log } from '../util/logger.js'
import { invokeSdk } from '../sdk/invoke.js'
import { liftTurnSignalListenerCap } from '../runtime/turn-signal.js'
import { loadProject } from '../projects/store.js'
import { dispatch } from '../hooks/dispatcher.js'
import { loadTask, listTasks } from './store.js'
import { runNode, type NodeRunOutcome } from './node-runner.js'
import { computeRunnable, downstreamOf, settledStatus } from './scheduler.js'
import { resolveAgentContext } from './agent-context.js'
import {
  emitMessage,
  emitPhaseStatus,
  emitRunDone,
  emitRunStarted,
  emitTaskStatus,
} from './emit.js'
import type { SessionSettings, Task, TaskMessage, WorkflowNode } from '../types/shared.js'

const CONCURRENCY_CAP = 4
const DEFAULT_MODEL = 'claude-opus-4-8'

interface TaskRuntime {
  inFlight: Map<string, AbortController>
  failed: boolean
  // Paused: stop dispatching NEW nodes (in-flight finish); task suspends at
  // 'paused' until resumeTask re-enables scheduling (ADR 0024 follow-up).
  paused: boolean
  scheduling: boolean
  rescanRequested: boolean
}

const registry = new Map<string, TaskRuntime>()

// Fire a task-lifecycle hook (ADR 0032). after-* events are non-blockable, so
// this is fire-and-forget — a misbehaving hook never stalls the engine.
function fireTaskHook(event: 'task.after-complete' | 'phase.after-approve', task: Task, detail: Record<string, unknown>): void {
  void (async () => {
    try {
      const project = await loadProject(task.projectId)
      await dispatch(
        event,
        { taskId: task.id, payload: detail },
        { projectId: task.projectId, ...(project?.path ? { workspace: project.path } : {}) },
      )
    } catch (err) {
      log.warn('task hook dispatch failed', { event, taskId: task.id, err: err instanceof Error ? err.message : String(err) })
    }
  })()
}

function ensureRuntime(taskId: string): TaskRuntime {
  let rt = registry.get(taskId)
  if (!rt) {
    rt = {
      inFlight: new Map(),
      failed: false,
      paused: false,
      scheduling: false,
      rescanRequested: false,
    }
    registry.set(taskId, rt)
  }
  return rt
}

function nextVersion(task: Task, nodeId: string): number {
  const runs = task.phases[nodeId]?.runs ?? []
  return runs.reduce((max, r) => Math.max(max, r.version), 0) + 1
}

function findNode(task: Task, nodeId: string): WorkflowNode | undefined {
  return task.workflowSnapshot?.nodes.find((n) => n.id === nodeId)
}

// Run one node end to end. Sets inFlight synchronously (caller relies on it for
// capacity accounting), then emits run.started, runs, and on settle re-requests
// a schedule pass.
function executeRun(
  taskId: string,
  node: WorkflowNode,
  task: Task,
  version: number,
  opts?: { instruction?: string; triggeredBy?: 'rerun' },
): void {
  const rt = ensureRuntime(taskId)
  const ac = new AbortController()
  // This per-node turn signal fans out to undici (per LLM request), parallel
  // tool calls, and subagents — lift Node's 10-listener cap to silence the
  // false-positive MaxListenersExceededWarning (see runtime/turn-signal.ts).
  liftTurnSignalListenerCap(ac.signal)
  rt.inFlight.set(node.id, ac)
  void (async () => {
    try {
      await emitPhaseStatus(taskId, node.id, 'running')
      await emitRunStarted(taskId, node.id, version, {
        agentId: node.agentId,
        ...(opts?.triggeredBy ? { triggeredBy: opts.triggeredBy } : {}),
      })
      if (opts?.instruction) {
        await emitMessage(taskId, node.id, version, {
          role: 'user',
          text: opts.instruction,
          at: new Date().toISOString(),
        })
      }
      let outcome: NodeRunOutcome
      try {
        outcome = await runNode({
          taskId,
          version,
          node,
          task,
          abortController: ac,
          ...(opts?.instruction ? { instruction: opts.instruction } : {}),
        })
      } catch (err) {
        log.warn('runNode threw', {
          taskId,
          nodeId: node.id,
          err: err instanceof Error ? err.message : String(err),
        })
        outcome = 'failed'
      }
      if (outcome === 'failed') {
        rt.failed = true
        await markDownstreamFailed(taskId, node.id)
      }
    } finally {
      rt.inFlight.delete(node.id)
      requestSchedule(taskId)
    }
  })()
}

async function markDownstreamFailed(taskId: string, nodeId: string): Promise<void> {
  const task = await loadTask(taskId)
  if (!task?.workflowSnapshot) return
  for (const did of downstreamOf(task.workflowSnapshot, nodeId)) {
    if (task.phases[did]?.status === 'pending') {
      // eslint-disable-next-line no-await-in-loop
      await emitPhaseStatus(taskId, did, 'failed')
    }
  }
}

async function finalize(taskId: string, task: Task): Promise<void> {
  const rt = registry.get(taskId)
  const status = rt?.failed ? 'failed' : settledStatus(task)
  if (!status) return
  let waitingApproval: string | null = null
  if (status === 'waiting_approval') {
    waitingApproval =
      Object.values(task.phases).find((p) => p.status === 'waiting_approval')?.nodeId ?? null
  }
  await emitTaskStatus(taskId, status, waitingApproval)
  // Terminal → drop runtime + fire task.after-complete (ADR 0032). waiting_approval
  // keeps the runtime so approve can resume.
  if (status === 'completed' || status === 'failed') {
    fireTaskHook('task.after-complete', task, { status, title: task.title })
    registry.delete(taskId)
  }
}

function requestSchedule(taskId: string): void {
  const rt = registry.get(taskId)
  if (!rt) return
  rt.rescanRequested = true
  if (rt.scheduling) return
  void runScheduleLoop(taskId)
}

async function runScheduleLoop(taskId: string): Promise<void> {
  const rt = registry.get(taskId)
  if (!rt) return
  rt.scheduling = true
  try {
    while (rt.rescanRequested) {
      rt.rescanRequested = false
      // eslint-disable-next-line no-await-in-loop
      await scheduleOnce(taskId)
    }
  } finally {
    rt.scheduling = false
  }
}

async function scheduleOnce(taskId: string): Promise<void> {
  const rt = registry.get(taskId)
  if (!rt) return
  const task = await loadTask(taskId)
  if (!task) return

  // Paused → don't dispatch new nodes (in-flight ones keep running).
  if (!rt.failed && !rt.paused) {
    const runnable = computeRunnable(task).filter((id) => !rt.inFlight.has(id))
    let capacity = CONCURRENCY_CAP - rt.inFlight.size
    for (const nodeId of runnable) {
      if (capacity <= 0) break
      const node = findNode(task, nodeId)
      if (!node) continue
      capacity -= 1
      // executeRun sets inFlight synchronously, so the capacity accounting and
      // the next scheduleOnce's dedup filter are correct.
      executeRun(taskId, node, task, nextVersion(task, nodeId))
    }
  }

  // Terminal/suspended check — only when nothing is in flight and no rescan is
  // queued (a queued rescan means more dispatch may still happen).
  if (rt.inFlight.size === 0 && !rt.rescanRequested) {
    if (rt.paused && !rt.failed) {
      // Suspended at user's request — keep the runtime so resume can continue.
      await emitTaskStatus(taskId, 'paused', null)
      return
    }
    await finalize(taskId, task)
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function startTask(taskId: string): void {
  ensureRuntime(taskId)
  void (async () => {
    await emitTaskStatus(taskId, 'running', null)
    requestSchedule(taskId)
  })()
}

export function cancelTask(taskId: string): boolean {
  const rt = registry.get(taskId)
  if (!rt) return false
  const had = rt.inFlight.size > 0
  for (const ac of rt.inFlight.values()) ac.abort()
  // Aborted runs surface as 'failed' via runNode's catch → finalize sets the
  // task failed. Nothing in flight → mark failed now.
  rt.failed = true
  if (!had) {
    void (async () => {
      const task = await loadTask(taskId)
      if (task) await finalize(taskId, task)
    })()
  }
  return had
}

// Pause: stop dispatching new nodes. In-flight nodes finish; once drained the
// task suspends at 'paused' (scheduleOnce). Does NOT abort running work.
export function pauseTask(taskId: string): boolean {
  const rt = registry.get(taskId)
  if (!rt || rt.paused) return false
  rt.paused = true
  requestSchedule(taskId)
  return true
}

// Resume a paused task — re-enable scheduling and continue from the frontier.
// Loads the task so it works after a restart (runtime is in-memory only).
export async function resumeTask(taskId: string): Promise<boolean> {
  const task = await loadTask(taskId)
  if (!task || task.status !== 'paused') return false
  const rt = ensureRuntime(taskId)
  rt.paused = false
  rt.failed = false
  await emitTaskStatus(taskId, 'running', null)
  requestSchedule(taskId)
  return true
}

export async function approvePhase(taskId: string, nodeId: string): Promise<void> {
  const task = await loadTask(taskId)
  if (!task) return
  const phase = task.phases[nodeId]
  if (!phase || phase.status !== 'waiting_approval') return
  const last = phase.runs[phase.runs.length - 1]
  const version = last?.version ?? 1
  await emitRunDone(taskId, nodeId, version, 'completed', last?.duration ?? null, {
    approvedBy: 'human',
    approvedAt: new Date().toISOString(),
  })
  await emitPhaseStatus(taskId, nodeId, 'completed')
  // phase.after-approve hook (ADR 0032) — the auto-commit-on-approve use case.
  fireTaskHook('phase.after-approve', task, { nodeId, version })
  ensureRuntime(taskId)
  await emitTaskStatus(taskId, 'running', null)
  requestSchedule(taskId)
}

export async function rerunPhase(
  taskId: string,
  nodeId: string,
  instruction?: string,
): Promise<void> {
  const task = await loadTask(taskId)
  if (!task?.workflowSnapshot) return
  const node = findNode(task, nodeId)
  if (!node) return
  const rt = ensureRuntime(taskId)
  rt.failed = false

  // Block downstream immediately by marking the trigger running (its first
  // await), then supersede its prior runs.
  await emitPhaseStatus(taskId, nodeId, 'running')
  const phase = task.phases[nodeId]
  for (const r of phase?.runs ?? []) {
    if (r.status === 'completed' || r.status === 'waiting_approval') {
      // eslint-disable-next-line no-await-in-loop
      await emitRunDone(taskId, nodeId, r.version, 'superseded', r.duration)
    }
  }

  // Invalidate transitive downstream (reachability BFS, ADR 0024 D-10).
  for (const did of downstreamOf(task.workflowSnapshot, nodeId)) {
    const dphase = task.phases[did]
    if (!dphase) continue
    for (const r of dphase.runs) {
      if (r.status !== 'superseded') {
        // eslint-disable-next-line no-await-in-loop
        await emitRunDone(taskId, did, r.version, 'superseded', r.duration)
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await emitPhaseStatus(taskId, did, 'pending')
  }

  await emitTaskStatus(taskId, 'running', null)
  // Dispatch the trigger run directly (phase is already 'running' so the
  // scheduler won't pick it up); downstream cascades once it completes.
  const fresh = (await loadTask(taskId)) ?? task
  executeRun(taskId, node, fresh, nextVersion(task, nodeId), {
    triggeredBy: 'rerun',
    ...(instruction ? { instruction } : {}),
  })
}

// Discussion: a focused Q&A about a run's artifact. Appends the user message,
// runs a lightweight tool-free turn, appends the agent reply. Does NOT create a
// run or supersede anything (human-approval.md).
export async function discussPhase(
  taskId: string,
  nodeId: string,
  runVersion: number,
  text: string,
): Promise<void> {
  const task = await loadTask(taskId)
  if (!task) return
  const node = findNode(task, nodeId)
  const phase = task.phases[nodeId]
  const run = phase?.runs.find((r) => r.version === runVersion)
  if (!node || !run) return

  const userMsg: TaskMessage = { role: 'user', text, at: new Date().toISOString() }
  await emitMessage(taskId, nodeId, runVersion, userMsg)

  try {
    const agentCtx = await resolveAgentContext({
      id: node.agentId,
      ...(node.agentSource ? { source: node.agentSource } : {}),
      ...(node.agentProjectId ? { projectId: node.agentProjectId } : {}),
    })
    const history = run.messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
      .join('\n\n')
    const prompt = [
      `You produced this artifact:\n\n${run.output}`,
      history ? `\n\nDiscussion so far:\n${history}` : '',
      `\n\nThe user asks: ${text}\n\nAnswer concisely. Do NOT modify files — this is a discussion only.`,
    ].join('')
    const settings: SessionSettings = {
      provider: 'anthropic',
      modelId: agentCtx.model || DEFAULT_MODEL,
      level: 'low',
      mode: 'execute',
    }
    const result = await invokeSdk(
      {
        prompt,
        settings,
        ...(agentCtx.systemPrompt ? { systemPrompt: agentCtx.systemPrompt } : {}),
        // No tools — discussion must not touch the repo.
        disabledTools: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'],
      },
      {},
    )
    await emitMessage(taskId, nodeId, runVersion, {
      role: 'agent',
      text: result.text || '(no reply)',
      at: new Date().toISOString(),
    })
  } catch (err) {
    log.warn('discuss failed', {
      taskId,
      nodeId,
      err: err instanceof Error ? err.message : String(err),
    })
    await emitMessage(taskId, nodeId, runVersion, {
      role: 'agent',
      text: '(failed to respond — see logs)',
      at: new Date().toISOString(),
    })
  }
}

// On sidecar boot: resume queued/running tasks from their durable frontier.
// completed/failed/waiting_approval are left untouched (execution-model.md).
export async function resumeOnBoot(): Promise<void> {
  let tasks: Task[]
  try {
    tasks = await listTasks()
  } catch (err) {
    log.warn('resumeOnBoot: listTasks failed', {
      err: err instanceof Error ? err.message : String(err),
    })
    return
  }
  for (const task of tasks) {
    if (
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'waiting_approval' ||
      task.status === 'paused'
    ) {
      // paused = user suspended it intentionally; leave it for an explicit resume.
      continue
    }
    // Reset interrupted in-flight runs (left 'running' at crash) so they re-run
    // cleanly when the user resumes — we can't resume a half-finished SDK turn.
    for (const phase of Object.values(task.phases)) {
      if (phase.status !== 'running') continue
      const last = phase.runs[phase.runs.length - 1]
      if (last && last.status === 'running') {
        // eslint-disable-next-line no-await-in-loop
        await emitRunDone(task.id, phase.nodeId, last.version, 'failed', null)
      }
      // eslint-disable-next-line no-await-in-loop
      await emitPhaseStatus(task.id, phase.nodeId, 'pending')
    }
    // Do NOT auto-resume: a kill/restart should not silently re-run agents
    // (costs tokens + mutates the repo without consent). Suspend at 'paused' so
    // the user explicitly clicks Resume to continue from the frontier.
    // eslint-disable-next-line no-await-in-loop
    await emitTaskStatus(task.id, 'paused', null)
    log.info('task suspended on boot (paused — resume to continue)', { taskId: task.id })
  }
}
