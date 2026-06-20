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

// ─── Glob scoping (ADR 0050) ──────────────────────────────────────────────────

// Extract path-like tokens from a turn's text (the user message / task prompt) so
// glob-scoped rules can match against what the turn references. A token qualifies
// when it contains a '/' (a real path) or ends in a short dotted file extension
// (e.g. Button.vue). Conservative: a false positive only over-includes a rule; a
// false negative just means the author can drop globs to force always-on.
const PATH_TOKEN_RE = /[\w./@-]*\/[\w./@-]+|\b[\w-]+\.[A-Za-z]\w{0,7}\b/g

export function extractTurnPaths(text: string | undefined): string[] {
  if (!text) return []
  const out = new Set<string>()
  for (const m of text.matchAll(PATH_TOKEN_RE)) {
    const tok = m[0].replace(/[.,;:)\]}'"]+$/, '')
    if (tok.length > 1) out.add(tok)
  }
  return [...out]
}

// Translate a simple glob (**, *, ?) to a RegExp anchored to a path segment, so
// `src/*.ts` matches `a/src/x.ts` and `**/*.vue` matches `foo.vue` or `a/b/foo.vue`.
function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`(^|/)${re}$`)
}

function matchesAnyGlob(path: string, globs: string[]): boolean {
  return globs.some((g) => {
    try {
      return globToRegExp(g).test(path)
    } catch {
      return false
    }
  })
}

// Returns the prompt block (or undefined when no enabled rule applies). Never
// throws — a load failure degrades to "no rules" so a turn is never blocked.
export async function buildRulesPrompt(
  projectId: string | undefined,
  // Paths referenced this turn (rules/inject extractTurnPaths). Glob-scoped rules
  // inject only when one matches; pass [] to inject only un-scoped rules.
  turnPaths: string[] = [],
): Promise<string | undefined> {
  let rules: Rule[]
  try {
    rules = await rulesFor(projectId)
  } catch (err) {
    log.warn('rules: inject load failed', { err: err instanceof Error ? err.message : String(err) })
    return undefined
  }
  const withBody = rules.filter((r) => r.body.trim().length > 0)
  // Glob-scoped rules (ADR 0050) inject only when a path referenced this turn
  // matches; rules without globs always inject (backward-compatible).
  const applicable = withBody.filter(
    (r) => !r.globs || r.globs.length === 0 || turnPaths.some((p) => matchesAnyGlob(p, r.globs!)),
  )
  if (applicable.length === 0) return undefined

  // Priority order (ADR 0035): project rules lead, then global.
  const ORDER: Record<string, number> = { project: 0, global: 1 }
  const rank = (r: Rule): number => ORDER[r.source ?? 'global'] ?? 2
  const sorted = [...applicable].sort((a, b) => rank(a) - rank(b))

  const sections = sorted.map((r) => `## ${r.name || r.id}\n\n${r.body.trim()}`).join('\n\n')
  return `<workspace-rules>\nThe user has defined the following workspace rules. Follow them unless they conflict with a direct instruction in the current turn.\n\n${sections}\n</workspace-rules>`
}
