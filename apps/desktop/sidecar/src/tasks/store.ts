// Event-sourced task storage. Each task lives in its own directory at
// ~/.awog/tasks/<id>/ containing:
//   events.log  — append-only JSONL, the authoritative state (ADR 0024 D-2)
//   task.json   — derived snapshot cache (fold of events), rewritten debounced
//   artifacts/  — node output files (written by the node-runner)
//
// Writes are O(1) appends serialised by a per-task lock; the snapshot is folded
// in-memory and flushed debounced so a trace-heavy node doesn't rewrite task.json
// hundreds of times. Crash-safe: a partial last JSONL line is skipped by fold,
// and events.log always wins over a stale task.json on reload.
//
// Delete is logical: a `task.deleted` event tombstones the directory.

import { mkdir, readdir, readFile, appendFile, writeFile, chmod, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import type {
  Task,
  TaskMessage,
  TaskPhase,
  TaskRun,
  TaskStatus,
  PhaseStatus,
  RunStatus,
  TraceNode,
} from '../types/shared.js'

export type TaskEvent =
  | { type: 'task.created'; at: string; task: Task }
  | { type: 'task.renamed'; at: string; title: string }
  | { type: 'task.status'; at: string; status: TaskStatus; currentNodeId?: string | null; waitingApproval?: string | null }
  | { type: 'phase.status'; at: string; nodeId: string; status: PhaseStatus }
  | { type: 'run.started'; at: string; nodeId: string; version: number; triggeredBy?: TaskRun['triggeredBy'] }
  | { type: 'run.status'; at: string; nodeId: string; version: number; status: RunStatus; duration?: string | null }
  | { type: 'run.output'; at: string; nodeId: string; version: number; output: string }
  | { type: 'run.approved'; at: string; nodeId: string; version: number; approvedBy: 'human' | 'auto'; approvedAt: string }
  | { type: 'trace.node'; at: string; nodeId: string; version: number; node: TraceNode; parentId?: string | null }
  | { type: 'message.appended'; at: string; nodeId: string; version: number; message: TaskMessage }
  | { type: 'artifact.written'; at: string; nodeId: string; version: number; path: string; bytes: number; commitSha?: string }
  | { type: 'task.deleted'; at: string }

const TASKS_DIR_NAME = sanitizeChild('tasks')
const SNAPSHOT_DEBOUNCE_MS = 150

function tasksDir(): string {
  return join(awogHome(), TASKS_DIR_NAME)
}

export function taskDir(id: string): string {
  return join(tasksDir(), sanitizeChild(id))
}

export function taskArtifactsDir(id: string): string {
  return join(taskDir(id), 'artifacts')
}

function eventsFile(id: string): string {
  return join(taskDir(id), 'events.log')
}

function snapshotFile(id: string): string {
  return join(taskDir(id), 'task.json')
}

async function ensureTaskDir(id: string): Promise<void> {
  await mkdir(taskDir(id), { recursive: true, mode: 0o700 })
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

// ─── Per-task lock + in-memory snapshot cache ────────────────────────────────

const TASK_LOCKS = new Map<string, Promise<unknown>>()
const SNAPSHOTS = new Map<string, Task | null>()
const SNAPSHOT_TIMERS = new Map<string, ReturnType<typeof setTimeout>>()

async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = TASK_LOCKS.get(id) ?? Promise.resolve()
  const next = prev.then(fn, fn) as Promise<T>
  TASK_LOCKS.set(id, next)
  try {
    return await next
  } finally {
    if (TASK_LOCKS.get(id) === next) TASK_LOCKS.delete(id)
  }
}

// ─── Trace tree upsert (by node id, optional parent nesting) ─────────────────

function replaceTraceById(list: TraceNode[], node: TraceNode): boolean {
  for (let i = 0; i < list.length; i += 1) {
    const cur = list[i]
    if (!cur) continue
    if (cur.id === node.id) {
      const merged: TraceNode = { ...node }
      // Preserve accumulated children across running→done updates.
      if (cur.children) merged.children = cur.children
      list[i] = merged
      return true
    }
    const kids = cur.children
    if (kids && replaceTraceById(kids, node)) return true
  }
  return false
}

function findTraceById(list: TraceNode[], id: string): TraceNode | null {
  for (const cur of list) {
    if (cur.id === id) return cur
    if (cur.children) {
      const hit = findTraceById(cur.children, id)
      if (hit) return hit
    }
  }
  return null
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

function findRun(phase: TaskPhase | undefined, version: number): TaskRun | undefined {
  return phase?.runs.find((r) => r.version === version)
}

// ─── Fold (deterministic reconstruction) ─────────────────────────────────────

function applyEvent(snapshot: Task | null, e: TaskEvent): Task | null {
  if (e.type === 'task.created') {
    // Deep-ish clone so the cached snapshot never aliases the event payload.
    return JSON.parse(JSON.stringify(e.task)) as Task
  }
  if (e.type === 'task.deleted') return null
  if (!snapshot) return snapshot

  switch (e.type) {
    case 'task.renamed': {
      snapshot.title = e.title
      break
    }
    case 'task.status': {
      snapshot.status = e.status
      if (e.currentNodeId !== undefined) snapshot.currentNodeId = e.currentNodeId
      if (e.waitingApproval !== undefined) snapshot.waitingApproval = e.waitingApproval
      break
    }
    case 'phase.status': {
      const phase = snapshot.phases[e.nodeId]
      if (phase) phase.status = e.status
      break
    }
    case 'run.started': {
      const phase = snapshot.phases[e.nodeId]
      if (phase) {
        const run: TaskRun = {
          version: e.version,
          status: 'running',
          output: '',
          trace: [],
          messages: [],
          duration: null,
        }
        if (e.triggeredBy !== undefined) run.triggeredBy = e.triggeredBy
        phase.runs.push(run)
      }
      break
    }
    case 'run.status': {
      const run = findRun(snapshot.phases[e.nodeId], e.version)
      if (run) {
        run.status = e.status
        if (e.duration !== undefined) run.duration = e.duration
      }
      break
    }
    case 'run.output': {
      const run = findRun(snapshot.phases[e.nodeId], e.version)
      if (run) run.output = e.output
      break
    }
    case 'run.approved': {
      const run = findRun(snapshot.phases[e.nodeId], e.version)
      if (run) {
        run.approvedBy = e.approvedBy
        run.approvedAt = e.approvedAt
      }
      break
    }
    case 'trace.node': {
      const run = findRun(snapshot.phases[e.nodeId], e.version)
      if (run) upsertTrace(run.trace, e.node, e.parentId)
      break
    }
    case 'message.appended': {
      const run = findRun(snapshot.phases[e.nodeId], e.version)
      if (run) run.messages.push(e.message)
      break
    }
    case 'artifact.written':
      // Informational — recorded in events.log; no snapshot mutation (the run's
      // output already references the artifact). Kept in the union for the trace
      // pipeline + UI emit.
      break
    default:
      break
  }
  return snapshot
}

function parseLine(line: string, file: string, lineNo: number): TaskEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as TaskEvent
  } catch (err) {
    log.warn('tasks jsonl: bad line skipped', {
      file,
      lineNo,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

async function foldFromDisk(id: string): Promise<Task | null> {
  const file = eventsFile(id)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
  const lines = raw.split('\n')
  let snapshot: Task | null = null
  for (let i = 0; i < lines.length; i += 1) {
    const evt = parseLine(lines[i] ?? '', file, i + 1)
    if (evt) snapshot = applyEvent(snapshot, evt)
  }
  return snapshot
}

// ─── Snapshot cache + debounced flush ────────────────────────────────────────

async function writeSnapshot(id: string): Promise<void> {
  const snap = SNAPSHOTS.get(id)
  if (snap === undefined) return
  const file = snapshotFile(id)
  if (snap === null) return // tombstoned — leave the last task.json for forensics
  try {
    await ensureTaskDir(id)
    const tmp = `${file}.tmp.${process.pid}`
    await writeFile(tmp, JSON.stringify(snap, null, 2), 'utf8')
    await chmod(tmp, 0o600)
    await rename(tmp, file)
  } catch (err) {
    log.warn('tasks: snapshot write failed (events.log remains truth)', {
      id,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

function scheduleSnapshot(id: string, immediate: boolean): void {
  const prev = SNAPSHOT_TIMERS.get(id)
  if (prev) clearTimeout(prev)
  if (immediate) {
    SNAPSHOT_TIMERS.delete(id)
    void writeSnapshot(id)
    return
  }
  SNAPSHOT_TIMERS.set(
    id,
    setTimeout(() => {
      SNAPSHOT_TIMERS.delete(id)
      void writeSnapshot(id)
    }, SNAPSHOT_DEBOUNCE_MS),
  )
}

// trace.node bursts are debounced; everything else flushes the snapshot now so
// task.json reflects status transitions promptly.
function isHighFrequency(evt: TaskEvent): boolean {
  return evt.type === 'trace.node' || evt.type === 'run.output'
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function appendTaskEvent(taskId: string, evt: TaskEvent): Promise<void> {
  await withLock(taskId, async () => {
    await ensureTaskDir(taskId)
    await appendFile(eventsFile(taskId), `${JSON.stringify(evt)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    // Update the in-memory snapshot. Fold from disk first if we haven't cached
    // this task yet (e.g. after restart) so we don't lose prior state.
    if (!SNAPSHOTS.has(taskId)) {
      SNAPSHOTS.set(taskId, await foldFromDisk(taskId))
    } else {
      SNAPSHOTS.set(taskId, applyEvent(SNAPSHOTS.get(taskId) ?? null, evt))
    }
  })
  scheduleSnapshot(taskId, !isHighFrequency(evt))
}

export async function createTask(task: Task): Promise<void> {
  await appendTaskEvent(task.id, {
    type: 'task.created',
    at: new Date().toISOString(),
    task,
  })
}

export async function renameTask(id: string, title: string): Promise<void> {
  await appendTaskEvent(id, { type: 'task.renamed', at: new Date().toISOString(), title })
}

export async function deleteTask(id: string): Promise<void> {
  await appendTaskEvent(id, { type: 'task.deleted', at: new Date().toISOString() })
}

export async function loadTask(id: string): Promise<Task | null> {
  if (SNAPSHOTS.has(id)) return SNAPSHOTS.get(id) ?? null
  const snap = await foldFromDisk(id)
  SNAPSHOTS.set(id, snap)
  return snap
}

export async function listTasks(): Promise<Task[]> {
  let entries: string[]
  try {
    entries = await readdir(tasksDir())
  } catch (err) {
    if (isMissing(err)) return []
    throw err
  }
  const tasks: Task[] = []
  for (const name of entries) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const snap = await loadTask(name)
      if (snap) tasks.push(snap)
    } catch (err) {
      log.warn('tasks: failed to load', {
        name,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  // Newest first (createdAt ISO-8601 lexicographic).
  tasks.sort((a, b) => {
    if (a.createdAt === b.createdAt) return 0
    return a.createdAt < b.createdAt ? 1 : -1
  })
  return tasks
}
