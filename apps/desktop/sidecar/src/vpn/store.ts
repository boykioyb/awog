// VPN profile config persistence — ADR 0065. One file per entity at
//   ~/.awog/vpn-profiles/<id>.json
// Pattern mirrors ssh/store.ts + mcp/store.ts: atomic rewrite via .tmp + rename,
// delete = unlink. No secret ever reaches these files (credentials live in the
// keychain, see credentials.ts) — so saveProfile writes the config verbatim.

import { mkdir, readdir, readFile, writeFile, chmod, rename, unlink } from 'node:fs/promises'
import { basename as pathBasename, join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { VpnProfileConfigSchema } from './schema.js'
import type { VpnProfileConfig } from './schema.js'
import { deleteVpnCredential } from './credentials.js'

const PROFILES_DIR = sanitizeChild('vpn-profiles')

function profilesDir(): string {
  return join(awogHome(), PROFILES_DIR)
}

function profileFile(id: string): string {
  return join(profilesDir(), `${sanitizeChild(id)}.json`)
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

// Parse + validate one profile file. The filename is the source of truth for
// `id`; backfill it if the JSON omits it (hand-edit) so the file isn't silently
// dropped — same guard as ssh/store.ts.
function parse(raw: string, file: string): VpnProfileConfig | null {
  try {
    const obj = JSON.parse(raw) as unknown
    if (
      obj &&
      typeof obj === 'object' &&
      !Array.isArray(obj) &&
      typeof (obj as { id?: unknown }).id !== 'string'
    ) {
      const name = pathBasename(file)
      const derived = name.endsWith('.json') ? name.slice(0, -5) : name
      if (derived) (obj as { id: string }).id = derived
    }
    const res = VpnProfileConfigSchema.safeParse(obj)
    if (!res.success) {
      log.warn('vpn: invalid profile file', {
        file,
        issues: res.error.issues.map((i) => `${i.path.join('.')}:${i.message}`),
      })
      return null
    }
    return res.data
  } catch (err) {
    log.warn('vpn: failed to parse profile', {
      file,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

async function writeAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

export async function loadProfile(id: string): Promise<VpnProfileConfig | null> {
  const file = profileFile(id)
  try {
    const raw = await readFile(file, 'utf8')
    return parse(raw, file)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

export async function listProfiles(): Promise<VpnProfileConfig[]> {
  let entries: string[]
  try {
    entries = await readdir(profilesDir())
  } catch (err) {
    if (isMissing(err)) return []
    throw err
  }
  const out: VpnProfileConfig[] = []
  for (const name of entries) {
    if (!name.endsWith('.json') || name.includes('.tmp.')) continue
    const file = join(profilesDir(), name)
    try {
      // eslint-disable-next-line no-await-in-loop
      const raw = await readFile(file, 'utf8')
      const snap = parse(raw, file)
      if (snap) out.push(snap)
    } catch (err) {
      log.warn('vpn: failed to read profile file', {
        file,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export async function saveProfile(profile: VpnProfileConfig): Promise<void> {
  await mkdir(profilesDir(), { recursive: true, mode: 0o700 })
  await writeAtomic(profileFile(profile.id), profile)
}

export async function deleteProfile(id: string): Promise<void> {
  try {
    await unlink(profileFile(id))
  } catch (err) {
    if (!isMissing(err)) throw err
  }
  // Best-effort purge of any stored credential so we don't orphan a secret.
  await deleteVpnCredential(id)
}
