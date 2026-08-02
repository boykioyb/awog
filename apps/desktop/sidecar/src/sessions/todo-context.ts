// Session checklist context. A session's current checklist (Session.todos) is
// re-injected as a <session_checklist> block on EVERY turn.
//
// Why this exists: the model only ever sees its own last `TodoWrite` call in the
// conversation, so without this block a user who ticks an item in the UI would have
// that edit silently overwritten by the model's next `TodoWrite`. Injecting the
// persisted list makes the checklist shared state (user + model) instead of a
// read-only mirror of the model's intent.
//
// Built fresh each turn so the block reflects the latest state, whoever changed it.
import { parseTodos } from '../runtime/todos.js'
import type { TodoItem, TodoStatus } from '../types/shared.js'

// Bounds so a runaway checklist can't crowd the context window. char/4 ≈ tokens.
const MAX_ITEMS = 60
const MAX_CONTENT = 300

// Markdown-checkbox marks — the shape models are most used to reading.
const STATUS_MARK: Record<TodoStatus, string> = {
  pending: ' ',
  in_progress: '~',
  completed: 'x',
}

// Build the <session_checklist> block, or undefined when the session has no
// checklist yet (the model then plans from scratch as before).
//
// The list is L2 — it comes back from the session header on disk, which a user could
// have hand-edited — and the sink is the system prompt, so re-validate through
// parseTodos here rather than trusting the persisted shape. Never throws.
export function buildSessionChecklistBlock(
  todos: readonly TodoItem[] | undefined,
): string | undefined {
  if (!todos?.length) return undefined
  const items = parseTodos(todos)
  if (!items.length) return undefined

  const rows = items
    .slice(0, MAX_ITEMS)
    .map((t) => `- [${STATUS_MARK[t.status]}] ${t.content.slice(0, MAX_CONTENT)}`)
  const omitted = items.length - rows.length
  if (omitted > 0) rows.push(`- …and ${omitted} more item(s), not shown.`)

  return `<session_checklist>
This is the CURRENT checklist for this session. The user can edit it directly in the UI, so it may differ from the last \`TodoWrite\` you made — when they differ, THIS block is correct and yours is stale. Use it as your starting point: carry over every item unchanged unless you are actually changing it, never re-open an item the user marked completed, and never drop an item the user added.

Legend: \`[ ]\` pending, \`[~]\` in progress, \`[x]\` completed.
${rows.join('\n')}
</session_checklist>`
}
