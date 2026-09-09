// The session checklist (ADR 0069) on the Claude SDK path, rebuilt from the CLI's
// TASK tools instead of from TodoWrite.
//
// CLI 2.1.233 dropped TodoWrite from the tool surface on opus 4.8 / sonnet 5 /
// fable 5 / mythos 5 and newer; `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (buildSdkEnv in
// shared.ts) brings back the successor family instead — verified against CLI
// 2.1.263, where the flag adds exactly TaskCreate, TaskGet, TaskList, TaskUpdate
// and no TodoWrite. So on this path the checklist no longer arrives as one
// whole-list call: it arrives as per-item CRUD, and the authoritative list only
// exists inside the CLI.
//
// This tracker replays that CRUD into the TodoItem[] the rest of AWOG already
// speaks, so Session.todos, the pinned banner and the Plan tab behave the same on
// both runtimes. It reads the STRUCTURED tool output (SDKUserMessage
// `tool_use_result`, which the SDK documents as "render from it instead of parsing
// the tool_result text") rather than the human sentence the model is shown.
//
// Ids and the seed: the CLI's task store outlives a turn — a `TaskUpdate` on turn 5
// can address a task created on turn 1 — while the event adapter, and therefore this
// tracker, is built per turn. Seeding from the persisted list (whose items carry
// TodoItem.taskId for exactly this reason) is what stops a late update from
// replacing a five-item checklist with a one-item view of itself. An update whose
// id we still cannot resolve applies NOTHING and reports false: the caller then
// leaves the persisted list alone, so the worst case is a stale checklist rather
// than a corrupted one.

import type { TodoItem, TodoStatus } from '../../types/shared.js'

interface Entry {
  content: string
  status: TodoStatus
  // Present only for an item we can address by id — i.e. one the CLI told us about.
  // A seeded item from an older session (or one the user typed) has none, so an
  // incoming TaskUpdate cannot match it; it still rides along in the list.
  taskId?: string
}

export interface TaskChecklist {
  // Each returns whether the call actually changed the tracked list. False means
  // "don't publish": either the payload was junk or it addressed an item this turn
  // never learned about.
  applyCreate(structured: unknown): boolean
  applyUpdate(input: Record<string, unknown>, structured: unknown): boolean
  applyList(structured: unknown): boolean
  items(): TodoItem[]
}

// The tool names this tracker owns. TaskGet is deliberately absent: it is a pure
// read whose result adds nothing the list does not already have.
export const TASK_CHECKLIST_TOOLS: readonly string[] = ['TaskCreate', 'TaskUpdate', 'TaskList']

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asStatus(raw: unknown): TodoStatus | undefined {
  return raw === 'pending' || raw === 'in_progress' || raw === 'completed' ? raw : undefined
}

function asText(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

export function createTaskChecklist(seed: readonly TodoItem[] | undefined): TaskChecklist {
  // Insertion-ordered, which IS the checklist order the user sees. Keyed by the
  // CLI task id where we have one, and by a synthetic key otherwise so a seeded
  // item without an id still occupies its place in the list.
  const entries = new Map<string, Entry>()
  let synthetic = 0

  for (const item of seed ?? []) {
    const content = asText(item.content)
    if (!content) continue
    const status = asStatus(item.status) ?? 'pending'
    if (item.taskId) entries.set(item.taskId, { content, status, taskId: item.taskId })
    else entries.set(`seed:${(synthetic += 1)}`, { content, status })
  }

  return {
    applyCreate(structured) {
      const task = asRecord(asRecord(structured)?.task)
      const id = asText(task?.id)
      const content = asText(task?.subject)
      if (!id || !content) return false
      entries.set(id, { content, status: 'pending', taskId: id })
      return true
    },

    applyUpdate(input, structured) {
      const result = asRecord(structured)
      // The CLI reports a rejected update in the payload rather than as a tool
      // error, so an unchecked `success` would let us record a change the task
      // store never made.
      if (result?.success === false) return false
      const id = asText(input.taskId) || asText(result?.taskId)
      if (!id) return false
      const existing = entries.get(id)
      if (!existing) return false
      if (input.status === 'deleted') {
        entries.delete(id)
        return true
      }
      const status = asStatus(input.status)
      const content = asText(input.subject)
      if (!status && !content) return false
      entries.set(id, {
        content: content || existing.content,
        status: status ?? existing.status,
        taskId: id,
      })
      return true
    },

    applyList(structured) {
      const tasks = asRecord(structured)?.tasks
      if (!Array.isArray(tasks)) return false
      // Authoritative snapshot: replace wholesale, seed included. A task the CLI
      // no longer lists is gone, and its own ordering is the one to show.
      entries.clear()
      for (const raw of tasks) {
        const task = asRecord(raw)
        const id = asText(task?.id)
        const content = asText(task?.subject)
        if (!id || !content) continue
        entries.set(id, { content, status: asStatus(task?.status) ?? 'pending', taskId: id })
      }
      return true
    },

    items() {
      const out: TodoItem[] = []
      for (const e of entries.values()) {
        const item: TodoItem = { content: e.content, status: e.status }
        if (e.taskId) item.taskId = e.taskId
        out.push(item)
      }
      return out
    },
  }
}
