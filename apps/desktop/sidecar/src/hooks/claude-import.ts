// Import Claude Code hooks from settings.json (ADR 0032 amended). Maps the CC
// hook config into AWOG's read-only Hook shape. Only events AWOG actually fires
// are imported: PreToolUse → tool.before-call, PostToolUse → tool.after-call.
//
// CC config shape:
//   { "hooks": { "PreToolUse": [ { "matcher": "Edit|Write",
//       "hooks": [ { "type": "command", "command": "...", "timeout": 10 } ] } ] } }
//
// Imported hooks are dispatched with a Claude-Code-shaped stdin payload (see
// dispatcher.ts) so existing CC hook scripts keep working.

import { readFile, writeFile, rename } from 'node:fs/promises'
import { log } from '../util/logger.js'
import type { Hook, HookEvent, HookSource } from '../types/shared.js'

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

// Unique id scope per tier + project (must match between import + update).
function idScope(source: HookSource, projectId: string | undefined): string {
  const tierTag = source.replace('claude-', '') // user | project | local
  return projectId ? `${tierTag}-${projectId}` : tierTag
}

// Reverse of ccMatcherToGlob: AWOG glob "{Edit,Write}" → CC regex "Edit|Write";
// "Bash" → "Bash"; "" → undefined (omit matcher = match all).
function globToCcMatcher(glob: string | undefined): string | undefined {
  const g = (glob ?? '').trim()
  if (!g) return undefined
  if (g.startsWith('{') && g.endsWith('}')) {
    return g.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean).join('|')
  }
  return g
}

export interface ImportedHookPatch {
  command?: string
  matcherGlob?: string
  timeoutMs?: number
}

// Update one imported hook entry in a settings.json (identified by its
// synthesized id) and write the file back, preserving everything else. Returns
// true if the entry was found. ADR 0032 amended — in-app edit of imported hooks.
export async function updateImportedHookInFile(
  settingsPath: string,
  source: HookSource,
  projectId: string | undefined,
  id: string,
  patch: ImportedHookPatch,
): Promise<boolean> {
  let raw: string
  try {
    raw = await readFile(settingsPath, 'utf8')
  } catch (err) {
    if (isMissing(err)) return false
    throw err
  }
  const parsed = JSON.parse(raw) as { hooks?: Record<string, CcMatcherGroup[]> }
  const hooksObj = parsed.hooks
  if (!hooksObj) return false
  const scope = idScope(source, projectId)
  let found = false

  for (const ccEvent of Object.keys(EVENT_MAP)) {
    const groups = hooksObj[ccEvent]
    if (!Array.isArray(groups)) continue
    groups.forEach((group, gi) => {
      ;(group.hooks ?? []).forEach((h, hi) => {
        if (`cc-${scope}-${ccEvent.toLowerCase()}-${gi}-${hi}` !== id) return
        found = true
        if (patch.command !== undefined) h.command = patch.command
        if (patch.matcherGlob !== undefined) {
          const cc = globToCcMatcher(patch.matcherGlob)
          if (cc) group.matcher = cc
          else delete group.matcher
        }
        if (patch.timeoutMs !== undefined) {
          // CC timeout is in seconds; drop it when it's the default (60s) to keep
          // settings.json clean.
          const secs = Math.round(patch.timeoutMs / 1000)
          if (secs > 0 && secs !== 60) h.timeout = secs
          else delete h.timeout
        }
      })
    })
  }

  if (!found) return false
  const tmp = `${settingsPath}.tmp.${process.pid}`
  await writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  await rename(tmp, settingsPath)
  return true
}

// Parse one settings.json into imported AWOG hooks. Missing file → []. A parse
// error is logged and yields [] (never throws — import is best-effort).
export async function importClaudeHooks(
  settingsPath: string,
  source: HookSource,
  projectId: string | undefined,
): Promise<Hook[]> {
  let raw: string
  try {
    raw = await readFile(settingsPath, 'utf8')
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('hooks: failed to read CC settings', { settingsPath, err: err instanceof Error ? err.message : String(err) })
    }
    return []
  }

  let parsed: { hooks?: Record<string, CcMatcherGroup[]> }
  try {
    parsed = JSON.parse(raw) as { hooks?: Record<string, CcMatcherGroup[]> }
  } catch (err) {
    log.warn('hooks: CC settings not valid JSON', { settingsPath, err: err instanceof Error ? err.message : String(err) })
    return []
  }
  const hooksObj = parsed.hooks
  if (!hooksObj || typeof hooksObj !== 'object') return []

  // Per-tier/project id scope so the synthesized id is UNIQUE across projects
  // and tiers (otherwise every project's "cc-posttooluse-0-0" would collide —
  // breaking selection highlight, the run-log file, and trust keys).
  const scope = idScope(source, projectId)

  const out: Hook[] = []
  for (const [ccEvent, awogEvent] of Object.entries(EVENT_MAP)) {
    const groups = hooksObj[ccEvent]
    if (!Array.isArray(groups)) continue
    groups.forEach((group, gi) => {
      const glob = ccMatcherToGlob(group.matcher)
      const matcher = glob ? { toolName: glob } : {}
      ;(group.hooks ?? []).forEach((h, hi) => {
        if (h.type !== 'command' || typeof h.command !== 'string' || !h.command.trim()) return
        out.push({
          id: `cc-${scope}-${ccEvent.toLowerCase()}-${gi}-${hi}`,
          name: `${ccEvent}${group.matcher ? ` · ${group.matcher}` : ''}`,
          description: `Imported from ${settingsPath.replace(/^.*\/(\.claude\/.*)$/, '$1')}`,
          event: awogEvent,
          matcher,
          command: h.command,
          cwd: '${workspace}',
          timeoutMs: (typeof h.timeout === 'number' && h.timeout > 0 ? h.timeout : 60) * 1000,
          // PreToolUse can block (exit ≠ 0); PostToolUse is fire-and-forget.
          runMode: awogEvent === 'tool.before-call' ? 'blocking' : 'background',
          enabled: true,
          source,
          ...(projectId ? { projectId } : {}),
          readOnly: true,
        })
      })
    })
  }
  return out
}
