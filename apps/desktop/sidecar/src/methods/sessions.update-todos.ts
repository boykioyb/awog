import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { updateSessionMetadata } from '../sessions/store.js'

// Replace a session's current checklist with the user's edited list. This is the
// write half of the editable checklist: the model writes the same field through
// TodoWrite (runtime ToolFilter.todoSink) and both are re-injected into the next
// turn as <session_checklist> (sessions/todo-context.ts), so a user tick is not
// overwritten by the model's next call.
//
// The payload is L1 (IPC from the UI): the schema is the validation boundary —
// unknown fields are stripped, an empty list is legal (it clears the checklist),
// and content is length-capped so a runaway list can't bloat the header line.
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
  await updateSessionMetadata(params.sessionId, { todos: params.todos })
  return { ok: true }
})
