import { mkdir, readFile, writeFile, chmod, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'

// Single dumb blob store for UI app settings (ADR 0045). The sidecar does NOT
// coerce values or apply defaults — the UI owns the schema and coercion. This
// file must NEVER hold secrets (accounts / API keys live in credentials.json).
const FILE_NAME = sanitizeChild('settings.json')

function settingsPath(): string {
  return join(awogHome(), FILE_NAME)
}

async function ensureHome(): Promise<void> {
  await mkdir(awogHome(), { recursive: true, mode: 0o700 })
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

// Arbitrary key/value blob owned by the UI. The sidecar treats it opaquely.
export type SettingsBlob = Record<string, unknown>

function isPlainObject(value: unknown): value is SettingsBlob {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function loadSettings(): Promise<SettingsBlob> {
  const file = settingsPath()
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isPlainObject(parsed)) {
      throw new Error('settings.json is not a JSON object')
    }
    return parsed
  } catch (err) {
    // Missing file is the expected first-run state — return an empty blob
    // without creating a file (defaults live in the UI).
    if (isMissing(err)) return {}
    throw err
  }
}

// Serialize writes through a module-level promise chain so concurrent
// settings.set calls don't clobber each other in their read-modify-write.
let writeChain: Promise<unknown> = Promise.resolve()

async function writeMerged(patch: SettingsBlob): Promise<SettingsBlob> {
  // A corrupt existing file must not permanently block writes — treat any
  // load/parse failure as an empty base so the next save heals it.
  let current: SettingsBlob
  try {
    current = await loadSettings()
  } catch {
    current = {}
  }
  const merged = { ...current, ...patch }
  await ensureHome()
  const file = settingsPath()
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(merged, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
  return merged
}

export async function saveSettings(patch: SettingsBlob): Promise<SettingsBlob> {
  const run = writeChain.then(() => writeMerged(patch))
  // Keep the chain alive even if this write rejects — a settled tail lets the
  // next queued write proceed instead of inheriting the rejection forever.
  writeChain = run.catch(() => undefined)
  return run
}
