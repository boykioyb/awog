// Hook dispatcher (ADR 0032 D-1/D-6/D-7). The ONE place that matches an event
// against configured hooks, renders the command (shell-quoted template + stdin
// payload), spawns it, applies blocking semantics, and writes the audit log.
// Anchors (tasks/engine.ts, the tool factory, …) call dispatch() and never
// spawn directly.
//
// Hot-path safety: listEnabledHooksForDispatch is cached per project tier and
// invalidated on any hooks.* mutation. When no hook matches the event, dispatch
// returns immediately. A hook failure NEVER throws out of dispatch — only a
// genuine block (exit ≠ 0 on a blockable event) sets { blocked: true }.

import { spawn } from 'node:child_process'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { BLOCKABLE_EVENTS } from './schema.js'
import { listEnabledHooksForDispatch, expandHookEnv, appendRunRecord } from './store.js'
import type { Hook, HookEvent, HookPayload, HookRunRecord } from '../types/shared.js'

export interface DispatchResult {
  blocked: boolean
  // The hook + stderr that blocked, for the UI banner.
  blockedBy?: { id: string; name: string; stderr: string }
}

const NOT_BLOCKED: DispatchResult = { blocked: false }
const STDERR_SNIPPET_MAX = 2000

// ─── Cache (per project tier) ────────────────────────────────────────────────

const cache = new Map<string, Promise<Hook[]>>()

function cacheKey(projectId: string | undefined): string {
  return projectId ?? '__global__'
}

async function hooksFor(projectId: string | undefined): Promise<Hook[]> {
  const key = cacheKey(projectId)
  let entry = cache.get(key)
  if (!entry) {
    // Evict a rejected load so a transient failure doesn't permanently disable
    // hooks for this tier (a stale rejected promise would fail every dispatch).
    entry = listEnabledHooksForDispatch(projectId).catch((err: unknown) => {
      cache.delete(key)
      throw err
    })
    cache.set(key, entry)
  }
  return entry
}

// Called by every hooks.* mutation method so the next dispatch reloads.
export function invalidateHookCache(): void {
  cache.clear()
}

// ─── Path resolution (matcher + template) ─────────────────────────────────────

function walk(obj: unknown, parts: string[]): unknown {
  let cur = obj
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

// Resolve a dotted matcher key. Try the detail bag (payload.payload) first, then
// the full payload root — so `path` → payload.payload.path and `event`/`taskId`
// resolve from the root.
function resolveMatcherKey(payload: HookPayload, key: string): unknown {
  const parts = key.split('.')
  const fromDetail = walk(payload.payload, parts)
  if (fromDetail !== undefined) return fromDetail
  return walk(payload as unknown, parts)
}

// Resolve a `{{...}}` template token against { event: payload } so the doc
// syntax `{{event.payload.path}}` / `{{event.taskId}}` works.
function resolveTemplateToken(payload: HookPayload, token: string): unknown {
  return walk({ event: payload }, token.trim().split('.'))
}

// ─── Glob matcher (no regex input → ReDoS-safe, D-7) ───────────────────────────

function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i += 1
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if (c === '{') {
      re += '(?:'
    } else if (c === '}') {
      re += ')'
    } else if (c === ',') {
      re += '|'
    } else {
      // Escape every other regex metacharacter — the input is a glob, not regex.
      re += (c as string).replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${re}$`)
}

function valueMatches(actual: unknown, pattern: string): boolean {
  const str = actual === undefined || actual === null ? '' : String(actual)
  // Fast path: no glob metachar → exact compare.
  if (!/[*?{}]/.test(pattern)) return str === pattern
  try {
    return globToRegExp(pattern).test(str)
  } catch {
    return str === pattern
  }
}

// AND across every matcher key. Empty matcher = match all.
function matcherMatches(hook: Hook, payload: HookPayload): boolean {
  for (const [key, pattern] of Object.entries(hook.matcher ?? {})) {
    if (!valueMatches(resolveMatcherKey(payload, key), pattern)) return false
  }
  return true
}

// ─── Command render (shell-quote substituted values, D-7) ──────────────────────

// POSIX single-quote wrap. Template values come from L1 payload (model/file-set
// paths) so they MUST be quoted before landing in the shell string.
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function renderCommand(hook: Hook, payload: HookPayload, workspace: string): string {
  return hook.command.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, token: string) => {
    if (token === 'workspace') return shellQuote(workspace)
    const v = resolveTemplateToken(payload, token)
    return shellQuote(v === undefined || v === null ? '' : String(v))
  })
}

function resolveCwd(hook: Hook, workspace: string): string {
  // ${workspace} is resolved here (NOT a shell var) so cwd can't escape via the
  // shell. Anything else is taken literally.
  if (hook.cwd === '${workspace}' || hook.cwd === '' || hook.cwd === undefined) return workspace
  return hook.cwd.replace('${workspace}', workspace)
}

// ─── Spawn ─────────────────────────────────────────────────────────────────

interface SpawnOutcome {
  exitCode: number
  stderr: string
}

// Imported Claude Code hooks expect CC's stdin schema + $CLAUDE_PROJECT_DIR, not
// AWOG's payload, so existing CC hook scripts (which read tool_input.file_path)
// keep working.
function ccEventName(event: HookPayload['event']): string {
  if (event === 'tool.before-call') return 'PreToolUse'
  if (event === 'tool.after-call') return 'PostToolUse'
  return event
}
function ccStdin(payload: HookPayload, workspace: string): string {
  const detail = payload.payload ?? {}
  return JSON.stringify({
    hook_event_name: ccEventName(payload.event),
    tool_name: detail.toolName ?? '',
    tool_input: detail.input ?? {},
    cwd: workspace,
    session_id: payload.sessionId ?? '',
  })
}

async function runHook(hook: Hook, payload: HookPayload, workspace: string): Promise<SpawnOutcome> {
  const imported = hook.readOnly === true
  const command = imported ? hook.command : renderCommand(hook, payload, workspace)
  const cwd = resolveCwd(hook, workspace)
  const env = {
    ...process.env,
    ...(imported ? { CLAUDE_PROJECT_DIR: workspace } : {}),
    ...(await expandHookEnv(hook)),
  }
  const stdinData = imported ? ccStdin(payload, workspace) : JSON.stringify(payload)
  return new Promise<SpawnOutcome>((resolvePromise) => {
    // shell:true so the user's command (pipes, &&, $VARS) works. Template values
    // are already single-quoted; secrets live in env, never in the arg string.
    const child = spawn(command, {
      shell: true,
      cwd,
      env,
      timeout: hook.timeoutMs,
      killSignal: 'SIGTERM',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < STDERR_SNIPPET_MAX) stderr += d.toString('utf8')
    })
    child.stdout?.on('data', () => {
      // stdout consumed but ignored in v1 (no payload-modify, ADR 0032 D-12).
    })
    child.on('error', (err) => {
      resolvePromise({ exitCode: 127, stderr: err.message })
    })
    child.on('close', (code, signal) => {
      // timeout → killed by SIGTERM → treat as 124 (matches the spec).
      const exitCode = signal ? 124 : (code ?? 0)
      resolvePromise({ exitCode, stderr: stderr.slice(0, STDERR_SNIPPET_MAX) })
    })
    // Payload on stdin (AWOG shape, or CC shape for imported hooks).
    try {
      child.stdin?.end(stdinData)
    } catch {
      // ignore — the hook may not read stdin
    }
  })
}

async function record(hook: Hook, outcome: SpawnOutcome, durationMs: number): Promise<void> {
  const rec: HookRunRecord = {
    at: new Date().toISOString(),
    durationMs,
    exitCode: outcome.exitCode,
    ...(outcome.stderr ? { stderr: outcome.stderr } : {}),
  }
  await appendRunRecord(hook.id, rec)
  emit('hook.run', {
    hookId: hook.id,
    source: hook.source ?? 'global',
    ...(hook.projectId ? { projectId: hook.projectId } : {}),
    event: hook.event,
    record: rec,
  })
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface DispatchOptions {
  projectId?: string
  // Workspace root used for ${workspace} expansion + default cwd. Falls back to
  // process.cwd() when absent.
  workspace?: string
}

// Fire an event. Matching enabled+trusted hooks run sequentially by id; a
// blockable event whose blocking hook exits non-zero aborts the action.
export async function dispatch(
  event: HookEvent,
  payload: Omit<HookPayload, 'event' | 'ts'>,
  opts: DispatchOptions = {},
): Promise<DispatchResult> {
  let candidates: Hook[]
  try {
    candidates = (await hooksFor(opts.projectId)).filter(
      (h) => h.event === event && h.trusted !== false,
    )
  } catch (err) {
    log.warn('hooks: dispatch load failed', { event, err: err instanceof Error ? err.message : String(err) })
    return NOT_BLOCKED
  }
  if (candidates.length === 0) return NOT_BLOCKED

  const full: HookPayload = { event, ts: new Date().toISOString(), ...payload }
  // Project-scoped hooks run before global ("ưu tiên project"); ties by id.
  const isProjectScoped = (h: Hook): boolean => h.source === 'project'
  const matched = candidates
    .filter((h) => matcherMatches(h, full))
    .sort((a, b) => {
      const rank = Number(!isProjectScoped(a)) - Number(!isProjectScoped(b))
      return rank !== 0 ? rank : a.id.localeCompare(b.id)
    })
  if (matched.length === 0) return NOT_BLOCKED

  const workspace = opts.workspace ?? process.cwd()
  const canBlock = BLOCKABLE_EVENTS.has(event)

  for (const hook of matched) {
    if (hook.runMode === 'background') {
      // Fire-and-forget: record when it settles, never block.
      const startedMs = Date.now()
      void runHook(hook, full, workspace)
        .then((outcome) => record(hook, outcome, Date.now() - startedMs))
        .catch((err: unknown) => {
          log.warn('hooks: background hook crashed', { id: hook.id, err: err instanceof Error ? err.message : String(err) })
        })
      continue
    }
    // blocking
    const startedMs = Date.now()
    let outcome: SpawnOutcome
    try {
      // eslint-disable-next-line no-await-in-loop
      outcome = await runHook(hook, full, workspace)
    } catch (err) {
      log.warn('hooks: blocking hook crashed', { id: hook.id, err: err instanceof Error ? err.message : String(err) })
      continue
    }
    // eslint-disable-next-line no-await-in-loop
    await record(hook, outcome, Date.now() - startedMs)
    if (canBlock && outcome.exitCode !== 0) {
      return {
        blocked: true,
        blockedBy: { id: hook.id, name: hook.name, stderr: outcome.stderr || `exit ${outcome.exitCode}` },
      }
    }
  }
  return NOT_BLOCKED
}

// Manual one-shot trigger (hooks.runOnce). Runs the hook regardless of matcher /
// enabled, records + emits, and returns the run record. The caller is
// responsible for the trust check (D-8) — an untrusted project hook must not
// reach here. `detail` seeds payload.payload for `{{...}}` templates.
export async function runHookOnce(
  hook: Hook,
  detail: Record<string, unknown>,
  workspace: string,
): Promise<HookRunRecord> {
  const full: HookPayload = { event: hook.event, ts: new Date().toISOString(), payload: detail }
  const startedMs = Date.now()
  const outcome = await runHook(hook, full, workspace)
  const durationMs = Date.now() - startedMs
  await record(hook, outcome, durationMs)
  return {
    at: new Date().toISOString(),
    durationMs,
    exitCode: outcome.exitCode,
    ...(outcome.stderr ? { stderr: outcome.stderr } : {}),
  }
}
