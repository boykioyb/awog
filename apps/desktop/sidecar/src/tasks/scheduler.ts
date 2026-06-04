// Pure DAG scheduling helpers for the parallel task engine (ADR 0024 D-1).
// No I/O — operate on a folded Task snapshot + its workflow DAG so they can be
// reasoned about and unit-tested in isolation. engine.ts owns the runtime
// (abort controllers, dispatch, concurrency cap) and calls these.

import type { Task, TaskStatus, Workflow } from '../types/shared.js'

function workflowOf(task: Task): Workflow | undefined {
  return task.workflowSnapshot
}

// Map nodeId → its upstream (incoming-edge source) node ids.
export function upstreamMap(wf: Workflow): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const n of wf.nodes) map.set(n.id, [])
  for (const e of wf.edges) map.get(e.to)?.push(e.from)
  return map
}

// A node is runnable when its phase is pending AND every upstream phase is
// completed. Roots (no upstream) are runnable immediately.
export function computeRunnable(task: Task): string[] {
  const wf = workflowOf(task)
  if (!wf) return []
  const upstream = upstreamMap(wf)
  const runnable: string[] = []
  for (const node of wf.nodes) {
    const phase = task.phases[node.id]
    if (!phase || phase.status !== 'pending') continue
    const deps = upstream.get(node.id) ?? []
    const ready = deps.every((d) => task.phases[d]?.status === 'completed')
    if (ready) runnable.push(node.id)
  }
  return runnable
}

// Transitive downstream of a node (reachability BFS over edges) — used by rerun
// invalidation and failure propagation. Excludes the start node.
export function downstreamOf(wf: Workflow, startId: string): string[] {
  const adj = new Map<string, string[]>()
  for (const n of wf.nodes) adj.set(n.id, [])
  for (const e of wf.edges) adj.get(e.from)?.push(e.to)
  const seen = new Set<string>()
  const queue = [...(adj.get(startId) ?? [])]
  while (queue.length) {
    const id = queue.shift() as string
    if (seen.has(id)) continue
    seen.add(id)
    for (const next of adj.get(id) ?? []) if (!seen.has(next)) queue.push(next)
  }
  return [...seen]
}

// Given no node is in-flight, what terminal/suspended status should the task be?
// Returns null when there is still work that could run (caller keeps scheduling).
export function settledStatus(task: Task): TaskStatus | null {
  const phases = Object.values(task.phases)
  if (phases.some((p) => p.status === 'failed')) return 'failed'
  if (computeRunnable(task).length > 0) return null
  if (phases.some((p) => p.status === 'running')) return null
  if (phases.some((p) => p.status === 'waiting_approval')) return 'waiting_approval'
  if (phases.every((p) => p.status === 'completed')) return 'completed'
  // Some phases are pending but nothing is runnable and nothing waits for
  // approval → they're blocked behind a failed/dead branch. Treat as failed.
  if (phases.some((p) => p.status === 'pending')) return 'failed'
  return 'completed'
}
