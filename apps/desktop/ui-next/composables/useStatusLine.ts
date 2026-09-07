import { computed, type ComputedRef } from 'vue'
import type { Session } from '~/composables/useSessionsData'
import { useSessionBranch } from '~/composables/useSessionBranch'
import { useGitDirtyCount } from '~/composables/useGitDirtyCount'
import { useSessionCost } from '~/composables/useSessionCost'
import { useProjects } from '~/composables/useProjects'
import {
  contextLimitForUsage,
  contextTokensFromUsage,
  formatTokenCount,
} from '~/utils/context-window'

// Custom status line (docs/features/statusline.md, issue #41).
//
// A template is a plain string with `{variable}` placeholders resolved against a
// FIXED table — it is NEVER executed. Running a user-supplied script from settings
// would break security invariant 8 (no eval / dynamic require on payload), and a
// template plus a documented variable list covers the actual ask.
//
// Segments: `|` splits the template. A segment that mentions at least one known
// variable and whose variables ALL resolve empty is dropped, so "no session" does
// not leave dangling separators. Unknown placeholders are left verbatim — the user
// sees their typo instead of a silent blank (the editor also warns).

export type StatusLineVarId =
  | 'project'
  | 'branch'
  | 'dirty'
  | 'model'
  | 'account'
  | 'style'
  | 'mode'
  | 'thinking'
  | 'cost'
  | 'context'
  | 'contextPct'
  | 'session'

// Display order in the editor's variable palette. Each id has a
// `settingsStatusline.var.<id>` description key.
export const STATUS_LINE_VARS: readonly StatusLineVarId[] = [
  'project',
  'branch',
  'dirty',
  'model',
  'account',
  'style',
  'mode',
  'thinking',
  'cost',
  'context',
  'contextPct',
  'session',
]

const KNOWN = new Set<string>(STATUS_LINE_VARS)
const PLACEHOLDER_RE = /\{([a-zA-Z]+)\}/g

export type StatusLineValues = Partial<Record<StatusLineVarId, string>>

// Placeholders in the template that are not in the table (editor warning).
export function unknownStatusLineVars(template: string): string[] {
  const out = new Set<string>()
  for (const m of template.matchAll(PLACEHOLDER_RE)) {
    const name = m[1]
    if (name && !KNOWN.has(name)) out.add(name)
  }
  return [...out]
}

// Render a template into the segments the status bar draws (dividers between).
// Pure: same inputs → same output, no reactivity, no DOM.
export function renderStatusLine(template: string, values: StatusLineValues): string[] {
  const out: string[] = []
  for (const raw of template.split('|')) {
    let known = 0
    let filled = 0
    const text = raw
      .replace(PLACEHOLDER_RE, (match, name: string) => {
        if (!KNOWN.has(name)) return match
        known++
        const value = values[name as StatusLineVarId] ?? ''
        if (value) filled++
        return value
      })
      .trim()
    // Drop a segment whose variables all came back empty; keep pure-literal
    // segments (known === 0) so a separator-only template still renders.
    if (known > 0 && filled === 0) continue
    if (text) out.push(text)
  }
  return out
}

// Live values for the active session. Session-scoped variables resolve to '' when
// there is no session, which drops their segment. Branch + dirty count reuse the
// same composables the branch chip uses (project-scoped, watcher-refreshed).
export function useStatusLineValues(session: () => Session | null): ComputedRef<StatusLineValues> {
  const { projectName } = useProjects()
  const { fmtUsd } = useSessionCost()
  const projectId = () => session()?.project || undefined
  const { branch } = useSessionBranch(projectId)
  const { dirtyCount } = useGitDirtyCount(projectId)

  return computed<StatusLineValues>(() => {
    const s = session()
    if (!s) return { branch: branch.value ?? '' }
    const usage = s.usage
    const tokens = contextTokensFromUsage(usage)
    const limit = contextLimitForUsage(s.model, usage)
    const pct = limit > 0 ? Math.round((tokens / limit) * 100) : 0
    return {
      project: s.project ? projectName(s.project) : '',
      branch: branch.value ?? '',
      dirty: dirtyCount.value > 0 ? String(dirtyCount.value) : '',
      model: s.model,
      account: s.account,
      style: s.style,
      mode: s.mode ?? '',
      thinking: s.thinkingLevel ?? '',
      cost: usage?.cost == null ? '' : fmtUsd(usage.cost),
      context: `${formatTokenCount(tokens)}/${formatTokenCount(limit)}`,
      contextPct: tokens > 0 ? `${pct}%` : '',
      session: s.title,
    }
  })
}
