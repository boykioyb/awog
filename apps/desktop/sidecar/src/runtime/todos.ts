// Parse a TodoWrite tool call's `todos` argument into the structured TodoItem[]
// the UI renders as a live checklist. Shared by sessions/step-mapper.ts and
// tasks/trace-mapper.ts so both runtimes surface the same shape (ADR 0030).
//
// The model's todo shape (Claude Code) is { content, status, ...extras }; we
// keep only content + a normalised status and drop the rest. Input is L1
// (model response) so we validate defensively — never throw, just skip junk.

import type { TodoItem, TodoStatus } from '../types/shared.js'

function normaliseStatus(raw: unknown): TodoStatus {
  return raw === 'completed' || raw === 'in_progress' ? raw : 'pending'
}

export function parseTodos(todos: unknown): TodoItem[] {
  if (!Array.isArray(todos)) return []
  const items: TodoItem[] = []
  for (const t of todos) {
    if (typeof t !== 'object' || t === null) continue
    const rec = t as Record<string, unknown>
    const content = typeof rec.content === 'string' ? rec.content.trim() : ''
    if (!content) continue
    items.push({ content, status: normaliseStatus(rec.status) })
  }
  return items
}

export function countDone(items: readonly TodoItem[]): number {
  return items.filter((t) => t.status === 'completed').length
}
