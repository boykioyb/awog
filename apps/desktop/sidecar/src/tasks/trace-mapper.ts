// Map SDK tool_use / tool_result / thinking events to the UI's TraceNode shape
// (apps/desktop/ui/types/index.ts). Sibling of sessions/step-mapper.ts but emits
// a tree node (agent → tool/subagent/thinking children) instead of a flat step.

import type { TraceNode } from '../types/shared.js'
import type { InvokeToolResult, InvokeToolUse } from '../sdk/invoke.js'
import { countDone, parseTodos } from '../runtime/todos.js'

// TodoWrite → a 'todo' trace node carrying the live checklist (built from the
// call input). Both the start and result events route here (node-runner emits
// both; they upsert by id) so the result never overwrites it with a generic
// tool row. `duration` differs between start (null) and end (elapsed).
function traceFromTodos(id: string, input: Record<string, unknown>, duration: string | null): TraceNode {
  const todos = parseTodos(input.todos)
  const node: TraceNode = { id, type: 'todo', duration }
  node.name = todos.length > 0 ? `Todos · ${countDone(todos)}/${todos.length}` : 'Todos'
  if (todos.length > 0) node.todos = todos
  return node
}

const RESULT_PREVIEW_MAX = 2_000

function truncate(text: string): string {
  return text.length > RESULT_PREVIEW_MAX ? `${text.slice(0, RESULT_PREVIEW_MAX)}\n…(truncated)` : text
}

function clip(text: string, max = 100): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// "What is this tool acting on" — a compact one-liner for the trace input field.
function pickTarget(name: string, input: Record<string, unknown>): string | undefined {
  if (name === 'Task') {
    const desc = input.description
    if (typeof desc === 'string' && desc.length > 0) return clip(desc)
  }
  const candidates = ['file_path', 'notebook_path', 'path', 'pattern', 'query', 'url', 'command', 'description']
  for (const key of candidates) {
    const v = input[key]
    if (typeof v === 'string' && v.length > 0) return clip(v)
  }
  // Fallback: a compact summary of the first scalar fields so tools whose input keys
  // aren't above (e.g. MCP get_pull_request({ owner, repo, pullNumber })) still show
  // their arguments instead of empty parens.
  const scalars = Object.entries(input)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    .slice(0, 3)
    .map(([key, v]) => `${key}: ${v}`)
  if (scalars.length > 0) return clip(scalars.join(', '))
  return undefined
}

function previewResult(content: unknown): string {
  if (typeof content === 'string') return truncate(content)
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (typeof block === 'object' && block !== null) {
        const rec = block as Record<string, unknown>
        if (rec.type === 'text' && typeof rec.text === 'string') parts.push(rec.text)
      }
    }
    return truncate(parts.join('\n'))
  }
  return ''
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

// Root node representing the node's agent. Tool/thinking nodes nest under it.
export function traceAgentNode(id: string, agentName: string, agentId: string): TraceNode {
  return {
    id,
    type: 'agent',
    name: agentName,
    agentName,
    agentId,
    duration: null,
    startedAt: new Date().toISOString(),
    status: 'running',
  }
}

export function traceFromToolUse(use: InvokeToolUse): TraceNode {
  if (use.name === 'TodoWrite') return traceFromTodos(use.id, use.input, null)
  const node: TraceNode = {
    id: use.id,
    // 'Task' tool = a subagent delegation; render as a subagent branch.
    type: use.name === 'Task' ? 'subagent' : 'tool',
    duration: null,
    startedAt: new Date().toISOString(),
    status: 'running',
  }
  if (use.name === 'Task') {
    const sub = typeof use.input.subagent_type === 'string' ? use.input.subagent_type : ''
    node.name = sub || 'general-purpose'
    const desc = typeof use.input.description === 'string' ? use.input.description : ''
    if (desc) node.purpose = desc
  } else {
    node.tool = use.name
    const target = pickTarget(use.name, use.input)
    if (target !== undefined) node.input = target
  }
  return node
}

export function traceFromToolResult(use: InvokeToolUse, result: InvokeToolResult, elapsedMs: number): TraceNode {
  if (use.name === 'TodoWrite') return traceFromTodos(use.id, use.input, formatDuration(elapsedMs))
  const node: TraceNode = {
    id: use.id,
    type: use.name === 'Task' ? 'subagent' : 'tool',
    duration: formatDuration(elapsedMs),
  }
  if (use.name === 'Task') {
    const sub = typeof use.input.subagent_type === 'string' ? use.input.subagent_type : ''
    node.name = sub || 'general-purpose'
    const desc = typeof use.input.description === 'string' ? use.input.description : ''
    if (desc) node.purpose = desc
  } else {
    node.tool = use.name
    const target = pickTarget(use.name, use.input)
    if (target !== undefined) node.input = target
  }
  const preview = previewResult(result.content)
  if (preview.length > 0) node.result = result.isError ? `[error] ${preview}` : preview
  return node
}

export function traceThinkingNode(id: string, text: string): TraceNode {
  return { id, type: 'thinking', text: truncate(text), duration: null }
}
