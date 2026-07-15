// SSH host + identity config persistence — ADR 0063. One file per entity at
//   ~/.awog/ssh-hosts/<id>.json      and
//   ~/.awog/ssh-identities/<id>.json
// Pattern mirrors mcp/store.ts: atomic rewrite via .tmp + rename, delete =
// unlink. No secret ever reaches these files (credentials live in the keychain,
// see credentials.ts) — so saveHost/saveIdentity write the config verbatim.

import { mkdir, readdir, readFile, writeFile, chmod, rename, unlink } from 'node:fs/promises'
import { basename as pathBasename, join } from 'node:path'
import { z } from 'zod'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { SshHostConfigSchema, SshIdentityConfigSchema } from './schema.js'
import type { SshHostConfig, SshIdentityConfig } from './schema.js'
import { deleteSshCredential } from './credentials.js'

const HOSTS_DIR = sanitizeChild('ssh-hosts')
const IDENTS_DIR = sanitizeChild('ssh-identities')

function hostsDir(): string {
  return join(awogHome(), HOSTS_DIR)
}

function identsDir(): string {
  return join(awogHome(), IDENTS_DIR)
}

function hostFile(id: string): string {
  return join(hostsDir(), `${sanitizeChild(id)}.json`)
}

function identFile(id: string): string {
  return join(identsDir(), `${sanitizeChild(id)}.json`)
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

// Parse + validate one config file. The filename is the source of truth for
// `id`; backfill it if the JSON omits it (hand-edit / LLM author) so the file
// isn't silently dropped — same guard as mcp/store.ts.
function parse<S extends z.ZodTypeAny>(
  raw: string,
  file: string,
  schema: S,
  label: string,
): z.infer<S> | null {
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
    const res = schema.safeParse(obj)
    if (!res.success) {
      log.warn(`ssh: invalid ${label} file`, {
        file,
        issues: res.error.issues.map((i) => `${i.path.join('.')}:${i.message}`),
      })
      return null
    }
    return res.data
  } catch (err) {
    log.warn(`ssh: failed to parse ${label}`, {
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

async function listDir<S extends z.ZodTypeAny>(
  dir: string,
  schema: S,
  label: string,
): Promise<z.infer<S>[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    if (isMissing(err)) return []
    throw err
  }
  const out: z.infer<S>[] = []
  for (const name of entries) {
    if (!name.endsWith('.json') || name.includes('.tmp.')) continue
    const file = join(dir, name)
    try {
      // eslint-disable-next-line no-await-in-loop
      const raw = await readFile(file, 'utf8')
      const snap = parse(raw, file, schema, label)
      if (snap) out.push(snap)
    } catch (err) {
      log.warn(`ssh: failed to read ${label} file`, {
        file,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return out
}

// ─── Hosts ───────────────────────────────────────────────────────────────────

export async function loadHost(id: string): Promise<SshHostConfig | null> {
  const file = hostFile(id)
  try {
    const raw = await readFile(file, 'utf8')
    return parse(raw, file, SshHostConfigSchema, 'host')
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

export async function listHosts(): Promise<SshHostConfig[]> {
  const hosts = await listDir(hostsDir(), SshHostConfigSchema, 'host')
  hosts.sort((a, b) => a.name.localeCompare(b.name))
  return hosts
}

export async function saveHost(host: SshHostConfig): Promise<void> {
  await mkdir(hostsDir(), { recursive: true, mode: 0o700 })
  await writeAtomic(hostFile(host.id), host)
}

export async function deleteHost(id: string): Promise<void> {
  try {
    await unlink(hostFile(id))
  } catch (err) {
    if (!isMissing(err)) throw err
  }
  // Best-effort purge of any stored password so we don't orphan a secret.
  await deleteSshCredential('host', id)
}

// ─── Identities ────────────────────────────────────────────────────────────

export async function loadIdentity(id: string): Promise<SshIdentityConfig | null> {
  const file = identFile(id)
  try {
    const raw = await readFile(file, 'utf8')
    return parse(raw, file, SshIdentityConfigSchema, 'identity')
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

export async function listIdentities(): Promise<SshIdentityConfig[]> {
  const idents = await listDir(identsDir(), SshIdentityConfigSchema, 'identity')
  idents.sort((a, b) => a.name.localeCompare(b.name))
  return idents
}

export async function saveIdentity(identity: SshIdentityConfig): Promise<void> {
  await mkdir(identsDir(), { recursive: true, mode: 0o700 })
  await writeAtomic(identFile(identity.id), identity)
}

export async function deleteIdentity(id: string): Promise<void> {
  try {
    await unlink(identFile(id))
  } catch (err) {
    if (!isMissing(err)) throw err
  }
  // Best-effort purge of any stored passphrase / inline key material.
  await deleteSshCredential('identity', id)
}
