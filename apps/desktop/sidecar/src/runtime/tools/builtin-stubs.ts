// Graceful stubs for Claude Code built-in tools the OAuth-conditioned model
// emits but AWOG doesn't implement (ADR 0030). Without these, the Pi agent loop
// returns "Tool <name> not found", which clutters the step list and wastes a
// round-trip while the model re-plans.
//
//   TodoWrite — the model's own scratch checklist. We ACK it (and surface the
//               list as a 'note' step via event-adapter) so the model's planning
//               loop works; AWOG has no separate todo store.
//   WebSearch — no web-search backend wired (no API key / provider). We return a
//               clear "not available" so the model proceeds or asks the user.
//               (WebFetch is now a real tool — see web-fetch-tool.ts, ADR 0042.)
//
// Both are added to the BASE toolset (createAwogToolDefinitions) so they exist
// for chat, tasks, AND subagents, and are filtered by allowedTools /
// disabledTools uniformly with every other tool.

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'

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

export function createTodoWriteTool(): AgentTool<typeof TodoWriteParams, TodoWriteDetails> {
  return {
    name: 'TodoWrite',
    label: 'Todos',
    description:
      'Record or update your task checklist for the current request. Use it to plan and track multi-step work; the list is shown to the user.',
    parameters: TodoWriteParams,
    async execute(_id, params): Promise<AgentToolResult<TodoWriteDetails>> {
      const count = Array.isArray(params.todos) ? params.todos.length : 0
      const done = Array.isArray(params.todos)
        ? params.todos.filter((t) => (t as { status?: unknown }).status === 'completed').length
        : 0
      return {
        content: [{ type: 'text', text: `Todos updated (${done}/${count} completed).` }],
        details: { count },
      }
    },
  }
}

const WebSearchParams = Type.Object(
  { query: Type.String({ description: 'The search query.' }) },
  { additionalProperties: true },
)

export function createWebSearchTool(): AgentTool<typeof WebSearchParams, Record<string, never>> {
  return {
    name: 'WebSearch',
    label: 'Web search',
    description:
      'Search the web. NOTE: web access is not available in this environment — calling this returns an unavailability notice, not results.',
    parameters: WebSearchParams,
    async execute(): Promise<AgentToolResult<Record<string, never>>> {
      return {
        content: [
          {
            type: 'text',
            text: 'Web search is not available in this environment. Proceed using the workspace files and your knowledge, or ask the user to provide the information.',
          },
        ],
        details: {},
      }
    },
  }
}
