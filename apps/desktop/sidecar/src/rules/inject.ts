// Rule injection (ADR 0033). Builds the `<workspace-rules>` block appended to
// the agent system prompt for a session/task turn: every enabled global rule +
// every enabled rule of the turn's project. Augments (never replaces) the
// agent's own prompt — callers concatenate the returned string onto
// systemPromptAppend.
//
// Cached per project tier and invalidated on any rules.* mutation, so the hot
// path (every turn) reloads from disk at most once per change.

import { log } from '../util/logger.js'
import { listEnabledRulesForInject } from './store.js'
import type { Rule } from '../types/shared.js'

const cache = new Map<string, Promise<Rule[]>>()

function cacheKey(projectId: string | undefined): string {
  return projectId ?? '__global__'
}

function rulesFor(projectId: string | undefined): Promise<Rule[]> {
  const key = cacheKey(projectId)
  let entry = cache.get(key)
  if (!entry) {
    entry = listEnabledRulesForInject(projectId).catch((err: unknown) => {
      cache.delete(key)
      throw err
    })
    cache.set(key, entry)
  }
  return entry
}

export function invalidateRulesCache(): void {
  cache.clear()
}

// Returns the prompt block (or undefined when no enabled rule applies). Never
// throws — a load failure degrades to "no rules" so a turn is never blocked.
export async function buildRulesPrompt(projectId: string | undefined): Promise<string | undefined> {
  let rules: Rule[]
  try {
    rules = await rulesFor(projectId)
  } catch (err) {
    log.warn('rules: inject load failed', { err: err instanceof Error ? err.message : String(err) })
    return undefined
  }
  const withBody = rules.filter((r) => r.body.trim().length > 0)
  if (withBody.length === 0) return undefined

  // Priority order (ADR 0035): project rules lead, then global.
  const ORDER: Record<string, number> = { project: 0, global: 1 }
  const rank = (r: Rule): number => ORDER[r.source ?? 'global'] ?? 2
  const sorted = [...withBody].sort((a, b) => rank(a) - rank(b))

  const sections = sorted.map((r) => `## ${r.name || r.id}\n\n${r.body.trim()}`).join('\n\n')
  return `<workspace-rules>\nThe user has defined the following workspace rules. Follow them unless they conflict with a direct instruction in the current turn.\n\n${sections}\n</workspace-rules>`
}
