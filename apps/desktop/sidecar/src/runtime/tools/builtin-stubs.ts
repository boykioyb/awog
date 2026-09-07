// Graceful stubs for Claude Code built-in tools the OAuth-conditioned model
// emits but AWOG doesn't implement (ADR 0030). Without these, the Pi agent loop
// returns "Tool <name> not found", which clutters the step list and wastes a
// round-trip while the model re-plans.
//
//   TodoWrite — the model's task checklist. We ACK it (and surface the list as a
//               'note' step via event-adapter) so the model's planning loop works.
//               When a `sink` is supplied (chat sessions) the list is ALSO persisted
//               as the session's current checklist, which is what makes it editable
//               by the user — see sessions/todo-context.ts. Without a sink (tasks,
//               subagents, one-shot) it stays a pure ACK.
//
// TodoWrite is added to the BASE toolset (createAwogToolDefinitions) so it exists
// for chat, tasks, AND subagents, and is filtered by allowedTools / disabledTools
// uniformly with every other tool.
//
// A `WebSearch` stub used to live here too: it declared the tool and then always
// answered "web search is not available". That is a lie told one tool call too
// late — the model spends a round-trip to learn the tool it was offered does
// nothing. It is gone; the Pi path simply does not advertise WebSearch, and
// ENGINEERING_PROMPT (runtime/prompts.ts) says so up front and points at WebFetch
// instead. (WebFetch is a real tool — see web-fetch-tool.ts, ADR 0042.)

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { countDone, parseTodos } from '../todos.js'
import { log } from '../../util/logger.js'
import type { TodoItem } from '../../types/shared.js'

// TodoWrite: accept the Claude Code todo shape permissively (content + status,
// plus any extras like activeForm/id/priority) and acknowledge.
const TodoWriteParams = Type.Object({
  todos: Type.Array(
    Type.Object(
      {
        content: Type.String(),
        status: Type.String(),
      },
      { additionalProperties: true },
    ),
  ),
})

interface TodoWriteDetails {
  count: number
}

// Persistence hook for the parsed checklist. Supplied only by the chat runtime,
// which writes it to Session.todos; see runtime/tools/index.ts ToolFilter.todoSink.
export type TodoSink = (todos: TodoItem[]) => void | Promise<void>

export function createTodoWriteTool(
  sink?: TodoSink,
): AgentTool<typeof TodoWriteParams, TodoWriteDetails> {
  return {
    name: 'TodoWrite',
    label: 'Todos',
    description:
      'Record or update your task checklist for the current request. Use it to plan and track multi-step work; the list is shown to the user.',
    parameters: TodoWriteParams,
    async execute(_id, params): Promise<AgentToolResult<TodoWriteDetails>> {
      // Normalise through the same parser the UI renders from, so the persisted
      // list, the ACK count and the transcript step never disagree.
      const items = parseTodos(params.todos)
      // Best-effort: a storage failure must not fail the tool call — the checklist
      // still surfaces from the transcript step.
      if (sink) {
        try {
          await sink(items)
        } catch (err) {
          // The tool itself still succeeded (the model's list is intact and the
          // transcript step renders it), so this is NOT a tool error — but it must
          // not vanish either: the user's editable checklist silently failed to
          // persist, and only a log makes that diagnosable.
          log.warn('TodoWrite: failed to persist session checklist', {
            err: err instanceof Error ? err.message : String(err),
          })
        }
      }
      return {
        content: [
          { type: 'text', text: `Todos updated (${countDone(items)}/${items.length} completed).` },
        ],
        details: { count: items.length },
      }
    },
  }
}
