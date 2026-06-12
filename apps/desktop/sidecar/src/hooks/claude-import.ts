// Parse Claude Code settings.json hooks into AWOG hook drafts for the migration
// assistant (ADR 0035 / config-import-assistant). Only events AWOG actually
// fires are mapped: PreToolUse → tool.before-call, PostToolUse → tool.after-call.
//
// CC config shape:
//   { "hooks": { "PreToolUse": [ { "matcher": "Edit|Write",
//       "hooks": [ { "type": "command", "command": "...", "timeout": 10 } ] } ] } }
//
// The returned drafts carry no source/projectId — the migration importer assigns
// the target tier and writes them into `.awog/hooks` via saveHook().

import { readFile } from 'node:fs/promises'
import { log } from '../util/logger.js'
import type { Hook, HookEvent } from '../types/shared.js'

// CC event → AWOG event (only the ones AWOG has a runtime anchor for).
const EVENT_MAP: Record<string, HookEvent> = {
  PreToolUse: 'tool.before-call',
  PostToolUse: 'tool.after-call',
}

interface CcCommandHook {
  type?: string
  command?: string
  timeout?: number
}
interface CcMatcherGroup {
  matcher?: string
  hooks?: CcCommandHook[]
}

// CC matcher is a regex on the tool name. Convert the common forms to an AWOG
// glob: "" / "*" / ".*" → match all; "A|B" → "{A,B}"; "Bash" → "Bash".
function ccMatcherToGlob(matcher: string | undefined): string | null {
  const s = (matcher ?? '').trim()
  if (s === '' || s === '*' || s === '.*') return null
  if (s.includes('|')) return `{${s.split('|').map((x) => x.trim()).filter(Boolean).join(',')}}`
  return s
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}

// A hook ready to be saved into `.awog` — source/projectId/trust assigned later.
export type ClaudeHookDraft = Omit<
  Hook,
  'source' | 'projectId' | 'trusted' | 'readOnly' | 'recentRuns'
>

// Parse one settings.json into AWOG hook drafts. Missing file → []. A parse
// error is logged and yields [] (never throws — import is best-effort).
export async function parseClaudeHooks(settingsPath: string): Promise<ClaudeHookDraft[]> {
  let raw: string
  try {
    raw = await readFile(settingsPath, 'utf8')
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('migration: failed to read CC settings', {
        settingsPath,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    return []
  }

  let parsed: { hooks?: Record<string, CcMatcherGroup[]> }
  try {
    parsed = JSON.parse(raw) as { hooks?: Record<string, CcMatcherGroup[]> }
  } catch (err) {
    log.warn('migration: CC settings not valid JSON', {
      settingsPath,
      err: err instanceof Error ? err.message : String(err),
    })
    return []
  }
  const hooksObj = parsed.hooks
  if (!hooksObj || typeof hooksObj !== 'object') return []

  const out: ClaudeHookDraft[] = []
  for (const [ccEvent, awogEvent] of Object.entries(EVENT_MAP)) {
    const groups = hooksObj[ccEvent]
    if (!Array.isArray(groups)) continue
    groups.forEach((group, gi) => {
      const glob = ccMatcherToGlob(group.matcher)
      const matcher = glob ? { toolName: glob } : {}
      ;(group.hooks ?? []).forEach((h, hi) => {
        if (h.type !== 'command' || typeof h.command !== 'string' || !h.command.trim()) return
        out.push({
          id: `imported-${ccEvent.toLowerCase()}-${gi}-${hi}`,
          name: `${ccEvent}${group.matcher ? ` · ${group.matcher}` : ''}`,
          description: 'Imported from Claude Code settings.json',
          event: awogEvent,
          matcher,
          command: h.command,
          cwd: '${workspace}',
          timeoutMs: (typeof h.timeout === 'number' && h.timeout > 0 ? h.timeout : 60) * 1000,
          // PreToolUse can block (exit ≠ 0); PostToolUse is fire-and-forget.
          runMode: awogEvent === 'tool.before-call' ? 'blocking' : 'background',
          enabled: true,
        })
      })
    })
  }
  return out
}
