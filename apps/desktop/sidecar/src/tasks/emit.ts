// Persist-and-emit helpers (ADR 0024 D-5). Every task state change is appended
// to events.log AND emitted on the sidecar-event channel under a `task.*` type,
// so the UI's live view is guaranteed to equal a fresh fold of the log. Keeping
// the pairing in one place means node-runner / scheduler / engine can't drift.

import { emit } from '../transport/stdio.js'
import { appendTaskEvent } from './store.js'
import type {
  PhaseStatus,
  RunStatus,
  TaskMessage,
  TaskRunUsage,
  TaskStatus,
  TraceNode,
} from '../types/shared.js'

const now = (): string => new Date().toISOString()

export async function emitTaskStatus(
  taskId: string,
  status: TaskStatus,
  waitingApproval: string | null,
): Promise<void> {
  await appendTaskEvent(taskId, { type: 'task.status', at: now(), status, waitingApproval })
  emit('task.status', { taskId, status, waitingApproval })
}

export async function emitPhaseStatus(
  taskId: string,
  nodeId: string,
  status: PhaseStatus,
): Promise<void> {
  await appendTaskEvent(taskId, { type: 'phase.status', at: now(), nodeId, status })
  emit('task.phase.status', { taskId, nodeId, status })
}

export async function emitRunStarted(
  taskId: string,
  nodeId: string,
  version: number,
  opts?: { agentId?: string; triggeredBy?: 'rerun' },
): Promise<void> {
  const evt = {
    type: 'run.started' as const,
    at: now(),
    nodeId,
    version,
    ...(opts?.triggeredBy ? { triggeredBy: opts.triggeredBy } : {}),
  }
  await appendTaskEvent(taskId, evt)
  emit('task.run.started', {
    taskId,
    nodeId,
    version,
    ...(opts?.agentId ? { agentId: opts.agentId } : {}),
    ...(opts?.triggeredBy ? { triggeredBy: opts.triggeredBy } : {}),
  })
}

// Streaming artifact text — emit only (the final text is persisted once via
// emitRunOutput so we don't append a JSONL line per token).
export function emitRunOutputDelta(
  taskId: string,
  nodeId: string,
  version: number,
  delta: string,
): void {
  emit('task.run.output', { taskId, nodeId, version, delta })
}

export async function emitRunOutput(
  taskId: string,
  nodeId: string,
  version: number,
  output: string,
): Promise<void> {
  await appendTaskEvent(taskId, { type: 'run.output', at: now(), nodeId, version, output })
  emit('task.run.output', { taskId, nodeId, version, output })
}

// Persist + emit the run's token usage (ADR 0054 — Activity cost attribution).
// `at` (the run completion time) becomes the Activity day-bucket key.
export async function emitRunUsage(
  taskId: string,
  nodeId: string,
  version: number,
  usage: TaskRunUsage,
): Promise<void> {
  await appendTaskEvent(taskId, { type: 'run.usage', at: now(), nodeId, version, usage })
  emit('task.run.usage', { taskId, nodeId, version, usage })
}

export async function emitTrace(
  taskId: string,
  nodeId: string,
  version: number,
  node: TraceNode,
  parentId: string | null,
): Promise<void> {
  await appendTaskEvent(taskId, {
    type: 'trace.node',
    at: now(),
    nodeId,
    version,
    node,
    ...(parentId ? { parentId } : {}),
  })
  emit('task.run.trace', { taskId, nodeId, version, node, parentId })
}

export async function emitMessage(
  taskId: string,
  nodeId: string,
  version: number,
  message: TaskMessage,
): Promise<void> {
  await appendTaskEvent(taskId, { type: 'message.appended', at: now(), nodeId, version, message })
  emit('task.message', { taskId, nodeId, version, message })
}

export async function emitArtifact(
  taskId: string,
  nodeId: string,
  version: number,
  path: string,
  bytes: number,
  commitSha?: string,
): Promise<void> {
  await appendTaskEvent(taskId, {
    type: 'artifact.written',
    at: now(),
    nodeId,
    version,
    path,
    bytes,
    ...(commitSha ? { commitSha } : {}),
  })
  emit('task.artifact.written', {
    taskId,
    nodeId,
    version,
    path,
    name: path.split('/').pop() ?? path,
    ...(commitSha ? { commitSha } : {}),
  })
}

// Terminal run transition. Persists run.status (+ run.approved when approved)
// and emits the combined task.run.done the UI listens for.
export async function emitRunDone(
  taskId: string,
  nodeId: string,
  version: number,
  status: RunStatus,
  duration: string | null,
  approved?: { approvedBy: 'human' | 'auto'; approvedAt: string },
): Promise<void> {
  await appendTaskEvent(taskId, { type: 'run.status', at: now(), nodeId, version, status, duration })
  if (approved) {
    await appendTaskEvent(taskId, {
      type: 'run.approved',
      at: now(),
      nodeId,
      version,
      approvedBy: approved.approvedBy,
      approvedAt: approved.approvedAt,
    })
  }
  emit('task.run.done', {
    taskId,
    nodeId,
    version,
    status,
    duration,
    ...(approved ? { approvedBy: approved.approvedBy, approvedAt: approved.approvedAt } : {}),
  })
}
