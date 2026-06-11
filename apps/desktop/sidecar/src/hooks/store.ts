// Hook persistence (ADR 0032 D-3/D-5/D-8). Two tiers, mirroring Workflows:
//   global  → ~/.awog/hooks/<id>.json              (authored locally → trusted)
//   project → {project.path}/.awog/hooks/<id>.json (travels with the repo)
//
// source/projectId/trusted/recentRuns are location- or runtime-derived and NOT
// part of the persisted JSON. Run audit log → ~/.awog/hooks/.runs/<id>.jsonl
// (append-only, trimmed to RUN_LOG_MAX on read). Project-tier trust decisions →
// {project.path}/.awog/.trust.json (NOT inside the hook file — a config must not
// vouch for itself, D-8). env `secret:KEY` refs reuse the MCP keychain helpers.

import { mkdir, readdir, readFile, writeFile, chmod, rename, unlink, appendFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'
import { expandSecrets, purgeServerSecrets } from '../mcp/secrets.js'
import { HookConfigSchema } from './schema.js'
import { importClaudeHooks, updateImportedHookInFile, type ImportedHookPatch } from './claude-import.js'
import type { Hook, HookRunRecord, HookScanReport, HookSource } from '../types/shared.js'

const HOOKS_DIR_NAME = sanitizeChild('hooks')
const RUNS_DIR_NAME = '.runs'
const TRUST_FILE = '.trust.json'
const RUN_LOG_MAX = 1000
const RECENT_RUNS_SHOWN = 20

// ─── Directory resolution ────────────────────────────────────────────────────

function globalHooksDir(): string {
  return join(awogHome(), HOOKS_DIR_NAME)
}

function projectHooksDir(projectPath: string): string {
  return join(projectPath, '.awog', HOOKS_DIR_NAME)
}

// Imported Claude Code settings.json locations (read-only).
function userClaudeSettings(): string {
  return join(homedir(), '.claude', 'settings.json')
}
function projectClaudeSettings(projectPath: string): string {
  return join(projectPath, '.claude', 'settings.json')
}
function projectClaudeSettingsLocal(projectPath: string): string {
  return join(projectPath, '.claude', 'settings.local.json')
}

// Only AWOG-native tiers can be written; claude-* are imported read-only.
function assertEditable(source: HookSource): void {
  if (source !== 'global' && source !== 'project') {
    throw new RpcError(-32602, `Hook source "${source}" is imported (read-only)`)
  }
}

async function resolveHooksDir(source: HookSource, projectId: string | undefined): Promise<string> {
  assertEditable(source)
  if (source === 'global') return globalHooksDir()
  if (!projectId) throw new RpcError(-32602, 'Project hook requires a projectId')
  const project = await loadProject(projectId)
  if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
  return projectHooksDir(project.path)
}

function hookFile(dir: string, id: string): string {
  return join(dir, `${sanitizeChild(id)}.json`)
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

// ─── Parse / tag ───────────────────────────────────────────────────────────

function parse(
  raw: string,
  file: string,
  source: HookSource,
  projectId: string | undefined,
): Hook | null {
  try {
    const obj = JSON.parse(raw) as unknown
    // Filename is the source of truth for id — backfill if a hand-edit omits it.
    if (obj && typeof obj === 'object' && typeof (obj as { id?: unknown }).id !== 'string') {
      const name = file.split('/').pop() ?? file
      const derived = name.endsWith('.json') ? name.slice(0, -5) : name
      if (derived) (obj as { id: string }).id = derived
    }
    const res = HookConfigSchema.safeParse(obj)
    if (!res.success) {
      log.warn('hooks: invalid config file', {
        file,
        issues: res.error.issues.map((i) => `${i.path.join('.')}:${i.message}`),
      })
      return null
    }
    const hook = res.data as Hook
    hook.source = source
    if (projectId) hook.projectId = projectId
    else delete hook.projectId
    return hook
  } catch (err) {
    log.warn('hooks: failed to parse', {
      file,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

async function listFromDir(
  dir: string,
  source: HookSource,
  projectId: string | undefined,
): Promise<Hook[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('hooks: listFromDir failed', { dir, err: err instanceof Error ? err.message : String(err) })
    }
    return []
  }
  const hooks: Hook[] = []
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    const file = join(dir, name)
    try {
      // eslint-disable-next-line no-await-in-loop
      const raw = await readFile(file, 'utf8')
      const hook = parse(raw, file, source, projectId)
      if (hook) hooks.push(hook)
    } catch (err) {
      log.warn('hooks: failed to read file', { file, err: err instanceof Error ? err.message : String(err) })
    }
  }
  return hooks
}

// ─── Trust (project tier, D-8) ───────────────────────────────────────────────

function trustFile(projectPath: string): string {
  return join(projectPath, '.awog', TRUST_FILE)
}

async function readTrustedIds(projectPath: string): Promise<Set<string>> {
  try {
    const raw = await readFile(trustFile(projectPath), 'utf8')
    const obj = JSON.parse(raw) as { hooks?: unknown }
    const ids = Array.isArray(obj.hooks) ? obj.hooks.filter((x): x is string => typeof x === 'string') : []
    return new Set(ids)
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('hooks: failed to read trust file', { projectPath, err: err instanceof Error ? err.message : String(err) })
    }
    return new Set()
  }
}

// Mark project-tier hooks trusted (additive). Global hooks need no entry.
export async function setHookTrust(projectId: string, hookIds: string[]): Promise<void> {
  const project = await loadProject(projectId)
  if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
  const existing = await readTrustedIds(project.path)
  hookIds.forEach((id) => existing.add(id))
  const file = trustFile(project.path)
  await mkdir(join(project.path, '.awog'), { recursive: true })
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify({ hooks: [...existing] }, null, 2), 'utf8')
  await rename(tmp, file)
}

// ─── Imported Claude Code hooks (read-only) ──────────────────────────────────

// ~/.claude/settings.json hooks — authored locally → trusted.
async function importedUserHooks(): Promise<Hook[]> {
  const hooks = await importClaudeHooks(userClaudeSettings(), 'claude-user', undefined)
  hooks.forEach((h) => {
    h.trusted = true
  })
  return hooks
}

// {project}/.claude/settings.json(.local) hooks — trust-gated like project tier
// (same .trust.json), since a cloned repo's hooks are arbitrary shell (D-8).
async function importedProjectHooks(
  projectPath: string,
  projectId: string,
  trusted: Set<string>,
): Promise<Hook[]> {
  const main = await importClaudeHooks(projectClaudeSettings(projectPath), 'claude-project', projectId)
  const local = await importClaudeHooks(projectClaudeSettingsLocal(projectPath), 'claude-local', projectId)
  const all = [...main, ...local]
  all.forEach((h) => {
    h.trusted = trusted.has(h.id)
  })
  return all
}

// ─── Public read API ──────────────────────────────────────────────────────────

// Full listing for the UI: tags location, resolves trust, attaches recent runs,
// and reports each scanned dir (mirrors listSkills → { skills, reports }).
export async function listHooks(
  projectIds: string[] = [],
): Promise<{ hooks: Hook[]; reports: HookScanReport[] }> {
  const reports: HookScanReport[] = []

  const global = await listFromDir(globalHooksDir(), 'global', undefined)
  global.forEach((h) => {
    h.trusted = true
  })
  reports.push({ dir: globalHooksDir(), source: 'global', found: global.length })

  // Imported user Claude Code hooks (~/.claude/settings.json).
  const userImported = await importedUserHooks()
  reports.push({ dir: userClaudeSettings(), source: 'claude-user', found: userImported.length })

  const projectResults = await Promise.all(
    projectIds.map(async (id) => {
      const project = await loadProject(id)
      if (!project) return []
      const dir = projectHooksDir(project.path)
      const native = await listFromDir(dir, 'project', id)
      const trusted = await readTrustedIds(project.path)
      native.forEach((h) => {
        h.trusted = trusted.has(h.id)
      })
      reports.push({ dir, source: 'project', found: native.length, projectId: id })
      // Imported {project}/.claude/settings.json(.local) hooks.
      const imported = await importedProjectHooks(project.path, id, trusted)
      reports.push({ dir: projectClaudeSettings(project.path), source: 'claude-project', found: imported.length, projectId: id })
      return [...native, ...imported]
    }),
  )

  const hooks = [...global, ...userImported, ...projectResults.flat()]
  // Attach recent runs (last N) for the detail view.
  await Promise.all(
    hooks.map(async (h) => {
      h.recentRuns = (await listRunRecords(h.id)).slice(-RECENT_RUNS_SHOWN).reverse()
    }),
  )
  hooks.sort((a, b) => a.name.localeCompare(b.name))
  return { hooks, reports }
}

// Enabled + trusted hooks for global + the given project — the dispatcher's
// source set (it filters by event/matcher). No run records (hot path).
export async function listEnabledHooksForDispatch(projectId: string | undefined): Promise<Hook[]> {
  const global = (await listFromDir(globalHooksDir(), 'global', undefined)).filter((h) => h.enabled)
  global.forEach((h) => {
    h.trusted = true
  })
  const userImported = await importedUserHooks()
  if (!projectId) return [...global, ...userImported]
  const project = await loadProject(projectId)
  if (!project) return [...global, ...userImported]
  const trusted = await readTrustedIds(project.path)
  const projHooks = (await listFromDir(projectHooksDir(project.path), 'project', projectId)).filter(
    (h) => h.enabled,
  )
  projHooks.forEach((h) => {
    h.trusted = trusted.has(h.id)
  })
  const projImported = await importedProjectHooks(project.path, projectId, trusted)
  return [...global, ...userImported, ...projHooks, ...projImported]
}

export async function loadHook(
  id: string,
  source: HookSource = 'global',
  projectId?: string,
): Promise<Hook | null> {
  const dir = await resolveHooksDir(source, projectId)
  try {
    const raw = await readFile(hookFile(dir, id), 'utf8')
    return parse(raw, hookFile(dir, id), source, projectId)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

// Resolve a hook's env `secret:KEY` refs to plaintext, namespaced by hook id.
export async function expandHookEnv(hook: Hook): Promise<Record<string, string>> {
  return expandSecrets(hook.id, hook.env)
}

// ─── Public write API ──────────────────────────────────────────────────────────

// Edit an IMPORTED hook (claude-*) by patching its Claude Code settings.json
// entry (ADR 0032 amended). Resolves the settings file from the tier, then
// updates command/matcher/timeout for the entry matching the synthesized id.
export async function saveImportedHook(
  source: HookSource,
  projectId: string | undefined,
  id: string,
  patch: ImportedHookPatch,
): Promise<void> {
  let settingsPath: string
  if (source === 'claude-user') {
    settingsPath = userClaudeSettings()
  } else {
    if (!projectId) throw new RpcError(-32602, 'Imported project hook requires a projectId')
    const project = await loadProject(projectId)
    if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
    if (source === 'claude-project') settingsPath = projectClaudeSettings(project.path)
    else if (source === 'claude-local') settingsPath = projectClaudeSettingsLocal(project.path)
    else throw new RpcError(-32602, `Source "${source}" is not an editable imported hook`)
  }
  const ok = await updateImportedHookInFile(settingsPath, source, projectId, id, patch)
  if (!ok) throw new RpcError(-32602, `Imported hook not found in ${settingsPath}: ${id}`)
}

export async function saveHook(hook: Hook): Promise<void> {
  const source = hook.source ?? 'global'
  const dir = await resolveHooksDir(source, hook.projectId)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  // Persist config fields only — location/runtime fields are derived.
  const persisted = {
    id: hook.id,
    name: hook.name,
    description: hook.description,
    event: hook.event,
    matcher: hook.matcher,
    command: hook.command,
    cwd: hook.cwd,
    timeoutMs: hook.timeoutMs,
    runMode: hook.runMode,
    enabled: hook.enabled,
    ...(hook.env ? { env: hook.env } : {}),
  }
  const file = hookFile(dir, hook.id)
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(persisted, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

export async function deleteHook(
  id: string,
  source: HookSource = 'global',
  projectId?: string,
): Promise<void> {
  // Purge any keychain secrets the hook referenced (best-effort).
  const existing = await loadHook(id, source, projectId).catch(() => null)
  if (existing?.env) await purgeServerSecrets(id, existing.env, undefined)
  const dir = await resolveHooksDir(source, projectId)
  try {
    await unlink(hookFile(dir, id))
  } catch (err) {
    if (!isMissing(err)) throw err
  }
}

// ─── Run audit log (JSONL, append-only, trimmed on read) ─────────────────────

function runsDir(): string {
  return join(globalHooksDir(), RUNS_DIR_NAME)
}

function runLogFile(id: string): string {
  return join(runsDir(), `${sanitizeChild(id)}.jsonl`)
}

export async function appendRunRecord(id: string, record: HookRunRecord): Promise<void> {
  try {
    await mkdir(runsDir(), { recursive: true, mode: 0o700 })
    await appendFile(runLogFile(id), `${JSON.stringify(record)}\n`, 'utf8')
  } catch (err) {
    log.warn('hooks: failed to append run record', { id, err: err instanceof Error ? err.message : String(err) })
  }
}

export async function listRunRecords(id: string): Promise<HookRunRecord[]> {
  let raw: string
  try {
    raw = await readFile(runLogFile(id), 'utf8')
  } catch (err) {
    if (isMissing(err)) return []
    log.warn('hooks: failed to read run log', { id, err: err instanceof Error ? err.message : String(err) })
    return []
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  const records: HookRunRecord[] = []
  for (const line of lines) {
    try {
      records.push(JSON.parse(line) as HookRunRecord)
    } catch {
      // skip a corrupt line
    }
  }
  // Trim the file lazily once it grows past the cap (keep the newest RUN_LOG_MAX).
  if (records.length > RUN_LOG_MAX) {
    const kept = records.slice(-RUN_LOG_MAX)
    const file = runLogFile(id)
    const tmp = `${file}.tmp.${process.pid}`
    try {
      await writeFile(tmp, `${kept.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8')
      await rename(tmp, file)
    } catch {
      // best-effort trim; keep serving the in-memory slice
    }
    return kept
  }
  return records
}
