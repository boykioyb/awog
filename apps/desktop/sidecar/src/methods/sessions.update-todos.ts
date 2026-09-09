import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { loadSession, updateSessionMetadata } from '../sessions/store.js'
import type { TodoItem } from '../types/shared.js'

// Replace a session's current checklist with the user's edited list. This is the
// write half of the editable checklist: the model writes the same field through
// TodoWrite (runtime ToolFilter.todoSink) on the Pi path and through the CLI's task
// tools on the Claude SDK path (claude-sdk/task-checklist.ts), and both are
// re-injected into the next turn as <session_checklist> (sessions/todo-context.ts),
// so a user tick is not overwritten by the model's next call.
//
// The payload is L1 (IPC from the UI): the schema is the validation boundary —
// unknown fields are stripped, an empty list is legal (it clears the checklist),
// and content is length-capped so a runaway list can't bloat the header line.
//
// TodoItem.taskId is deliberately NOT part of the payload: a CLI task id is a
// sidecar-internal detail and the UI has no business round-tripping it. It is
// re-attached here by matching content against the list already on disk, so a user
// who ticks or reorders rows does not strip the ids a later `TaskUpdate` resolves
// against. A row whose TEXT the user changed keeps no id — the checklist nudge tells
// the model to reconcile through TaskList/TaskCreate when the two disagree.
const MAX_ITEMS = 200
const MAX_CONTENT = 2000

const Params = z.object({
  sessionId: z.string().min(1),
  todos: z
    .array(
      z.object({
        content: z.string().min(1).max(MAX_CONTENT),
        status: z.enum(['pending', 'in_progress', 'completed']),
      }),
    )
    .max(MAX_ITEMS),
})

register('sessions.updateTodos', async (raw) => {
  const params = Params.parse(raw)
  // Best-effort id carry-over: an unreadable session just means no ids to keep.
  let taskIdByContent: Map<string, string> | undefined
  try {
    const current = (await loadSession(params.sessionId))?.todos
    if (current?.length) {
      taskIdByContent = new Map()
      for (const t of current) {
        if (t.taskId && !taskIdByContent.has(t.content)) taskIdByContent.set(t.content, t.taskId)
      }
    }
  } catch {
    /* best-effort: never fail the user's edit over the id carry-over */
  }
  const todos: TodoItem[] = params.todos.map((t) => {
    const taskId = taskIdByContent?.get(t.content)
    return taskId ? { ...t, taskId } : t
  })
  await updateSessionMetadata(params.sessionId, { todos })
  return { ok: true }
})
