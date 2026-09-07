import { mkdir, readFile, writeFile, chmod, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'

// Layered app-settings store (ADR 0045, extended to two tiers).
//
//   user    → ~/.awog/settings.json            (theo người dùng, đi cùng máy)
//   project → {project.path}/.awog/settings.json (commit được, đi cùng repo)
//
// The sidecar does NOT coerce values or apply defaults — the UI owns the schema
// and its defaults; this layer only stores, merges and reports WHICH tier each
// value came from. This file must NEVER hold secrets (accounts / API keys live
// in credentials.json).
//
// Merge depth is exactly TWO levels — `slice` and `slice.field` — because that is
// the real shape of the UI blob (`git.autoFetchIntervalMs`, `defaults.modelId`).
// Going deeper would have to guess how to merge arrays (projectIds, models…);
// going shallower would make a single project override freeze the whole slice.
const FILE_NAME = sanitizeChild('settings.json')

export type SettingsScope = 'user' | 'project'
// Arbitrary key/value blob owned by the UI. The sidecar treats it opaquely.
export type SettingsBlob = Record<string, unknown>
// 'user' | 'project' per resolved path ('git' or 'git.autoFetchIntervalMs').
export type SettingsOrigin = Record<string, SettingsScope>

export interface ResolvedSettings {
  user: SettingsBlob
  project: SettingsBlob | null
  effective: SettingsBlob
  origin: SettingsOrigin
}

function userSettingsPath(): string {
  return join(awogHome(), FILE_NAME)
}

function projectSettingsPath(projectPath: string): string {
  return join(projectPath, '.awog', FILE_NAME)
}

// Project tier path NEVER comes from the UI payload — only from the project row,
// so a caller cannot aim a write at an arbitrary directory (security invariant 2).
async function resolveProjectPath(projectId: string | undefined): Promise<string> {
  if (!projectId) throw new RpcError(-32602, 'Project-scoped settings require a projectId')
  const project = await loadProject(projectId)
  if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
  return projectSettingsPath(project.path)
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

function isPlainObject(value: unknown): value is SettingsBlob {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readBlob(file: string): Promise<SettingsBlob> {
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isPlainObject(parsed)) throw new Error(`${file} is not a JSON object`)
    return parsed
  } catch (err) {
    // Missing file is the expected first-run state — return an empty blob without
    // creating a file (defaults live in the UI).
    if (isMissing(err)) return {}
    throw err
  }
}

export async function loadSettings(): Promise<SettingsBlob> {
  return readBlob(userSettingsPath())
}

// Serialize writes PER FILE through a promise chain so concurrent settings.set
// calls don't clobber each other in their read-modify-write.
const writeChains = new Map<string, Promise<unknown>>()

function enqueue<T>(file: string, run: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(file) ?? Promise.resolve()
  const next = prev.then(run)
  // Keep the chain alive even if this write rejects — a settled tail lets the
  // next queued write proceed instead of inheriting the rejection forever.
  writeChains.set(
    file,
    next.catch(() => undefined),
  )
  return next
}

async function writeBlob(file: string, blob: SettingsBlob): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(blob, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

// Read-modify-write of one tier. `mutate` gets the current blob (empty on a
// corrupt/missing file — the next save then heals it) and returns the new one.
function updateFile(
  file: string,
  mutate: (current: SettingsBlob) => SettingsBlob,
): Promise<SettingsBlob> {
  return enqueue(file, async () => {
    let current: SettingsBlob
    try {
      current = await readBlob(file)
    } catch {
      current = {}
    }
    const next = mutate(current)
    await writeBlob(file, next)
    return next
  })
}

// Patch-merge, two levels deep: a plain-object slice merges field by field, any
// other value replaces. `undefined` in the patch deletes the key (JSON drops it
// anyway, so this keeps the on-disk file honest).
function applyPatch(current: SettingsBlob, patch: SettingsBlob): SettingsBlob {
  const out: SettingsBlob = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete out[key]
      continue
    }
    const prev = out[key]
    out[key] = isPlainObject(prev) && isPlainObject(value) ? { ...prev, ...value } : value
  }
  return out
}

// Remove `slice` or `slice.field` paths from a blob (used to clear an override so
// the value falls back to the tier below).
function applyUnset(current: SettingsBlob, paths: readonly string[]): SettingsBlob {
  const out: SettingsBlob = { ...current }
  for (const path of paths) {
    const dot = path.indexOf('.')
    if (dot < 0) {
      delete out[path]
      continue
    }
    const key = path.slice(0, dot)
    const field = path.slice(dot + 1)
    const slice = out[key]
    if (!isPlainObject(slice)) continue
    const copy = { ...slice }
    delete copy[field]
    out[key] = copy
  }
  return out
}

async function pathFor(scope: SettingsScope, projectId: string | undefined): Promise<string> {
  return scope === 'project' ? await resolveProjectPath(projectId) : userSettingsPath()
}

export async function saveSettings(
  patch: SettingsBlob,
  scope: SettingsScope = 'user',
  projectId?: string,
): Promise<SettingsBlob> {
  const file = await pathFor(scope, projectId)
  return updateFile(file, (current) => applyPatch(current, patch))
}

export async function unsetSettings(
  paths: readonly string[],
  scope: SettingsScope = 'user',
  projectId?: string,
): Promise<SettingsBlob> {
  const file = await pathFor(scope, projectId)
  return updateFile(file, (current) => applyUnset(current, paths))
}

export async function loadScoped(
  scope: SettingsScope,
  projectId?: string,
): Promise<SettingsBlob> {
  return readBlob(await pathFor(scope, projectId))
}

// Merge the two tiers and record where every value ended up coming from. Keys
// present only in the user tier stay 'user'; a project slice contributes
// 'project' per field it actually declares.
export function mergeLayers(user: SettingsBlob, project: SettingsBlob | null): ResolvedSettings {
  const effective: SettingsBlob = { ...user }
  const origin: SettingsOrigin = {}
  for (const [key, value] of Object.entries(user)) {
    origin[key] = 'user'
    if (isPlainObject(value)) for (const field of Object.keys(value)) origin[`${key}.${field}`] = 'user'
  }
  for (const [key, value] of Object.entries(project ?? {})) {
    const prev = effective[key]
    if (isPlainObject(prev) && isPlainObject(value)) {
      effective[key] = { ...prev, ...value }
      for (const field of Object.keys(value)) origin[`${key}.${field}`] = 'project'
      // The slice itself is only "from project" when every field is.
      origin[key] = Object.keys(prev).every((f) => f in value) ? 'project' : 'user'
    } else {
      effective[key] = value
      origin[key] = 'project'
      if (isPlainObject(value)) for (const field of Object.keys(value)) origin[`${key}.${field}`] = 'project'
    }
  }
  return { user, project, effective, origin }
}

// Full picture for the UI: both tiers, the merged result, and the origin map that
// lets a settings row show which tier its value came from. A missing/omitted
// projectId simply resolves the user tier alone.
export async function resolveSettings(projectId?: string): Promise<ResolvedSettings> {
  const user = await loadSettings()
  if (!projectId) return mergeLayers(user, null)
  const project = await readBlob(await resolveProjectPath(projectId))
  return mergeLayers(user, project)
}
