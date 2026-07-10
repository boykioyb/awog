// Source config persistence. One folder per source at
// ~/.awog/sources/<slug>/ — see ADR 0060. Folder layout mirrors agents/store.ts
// (per-entity dir); config.json write mirrors mcp/store.ts (atomic .tmp +
// chmod 0600 + rename, dir mode 0700, keychainize secret env/headers on save).
//
// Secret env/headers reuse the SAME keychain group as MCP (service `awog-mcp`,
// account `<id>/<key>` via mcp/secrets.ts). Preserving the source `id` means a
// token stored under the old MCP server id keeps resolving after migration.

import { mkdir, readdir, readFile, writeFile, chmod, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { keychainizeRecord } from '../mcp/secrets.js'
import { SourceConfigSchema, SourcePermissionsSchema } from './schema.js'
import type { SourcePermissions } from './schema.js'
import type { SourceConfig } from '../types/shared.js'

const DIR_NAME = sanitizeChild('sources')
const CONFIG_FILE = 'config.json'
const GUIDE_FILE = 'guide.md'
const PERMISSIONS_FILE = 'permissions.json'
const ICON_EXTS = ['svg', 'png', 'jpg', 'jpeg', 'webp'] as const

// Parsed guide.md: raw markdown + the sections agents consume as context.
export interface SourceGuide {
  raw: string
  scope?: string
  guidelines?: string
  context?: string
  apiNotes?: string
  cache?: Record<string, unknown>
}

function sourcesDir(): string {
  return join(awogHome(), DIR_NAME)
}

function sourceDir(slug: string): string {
  return join(sourcesDir(), sanitizeChild(slug))
}

function configFileFor(slug: string): string {
  return join(sourceDir(slug), CONFIG_FILE)
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

function parseConfig(raw: string, file: string): SourceConfig | null {
  try {
    const obj = JSON.parse(raw) as unknown
    const res = SourceConfigSchema.safeParse(obj)
    if (!res.success) {
      log.warn('sources: invalid config file', {
        file,
        issues: res.error.issues.map((i) => `${i.path.join('.')}:${i.message}`),
      })
      return null
    }
    return res.data
  } catch (err) {
    log.warn('sources: failed to parse', {
      file,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

export async function loadSource(slug: string): Promise<SourceConfig | null> {
  const file = configFileFor(slug)
  try {
    const raw = await readFile(file, 'utf8')
    return parseConfig(raw, file)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

export async function listSources(): Promise<SourceConfig[]> {
  let names: string[]
  try {
    const entries = await readdir(sourcesDir(), { withFileTypes: true })
    names = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
  } catch (err) {
    if (isMissing(err)) return []
    throw err
  }
  const out: SourceConfig[] = []
  for (const name of names) {
    const file = configFileFor(name)
    try {
      // eslint-disable-next-line no-await-in-loop
      const raw = await readFile(file, 'utf8')
      const cfg = parseConfig(raw, file)
      if (cfg) out.push(cfg)
    } catch (err) {
      if (!isMissing(err)) {
        log.warn('sources: failed to read config', {
          file,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug))
  return out
}

async function writeConfigAtomic(slug: string, cfg: SourceConfig): Promise<void> {
  await mkdir(sourceDir(slug), { recursive: true, mode: 0o700 })
  const file = configFileFor(slug)
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(cfg, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

export async function saveSource(cfg: SourceConfig): Promise<void> {
  // Invariant 1 / ADR 0018: secret-looking env/header values must never reach
  // disk in plaintext — move them to the OS keychain and persist only the
  // `secret:KEY` reference. Only MCP sources carry env/headers in config today
  // (api credentials live in the credential store from phase P3 on).
  let toWrite: SourceConfig = cfg
  if (cfg.type === 'mcp') {
    const env = await keychainizeRecord(cfg.id, cfg.mcp.env)
    const headers = await keychainizeRecord(cfg.id, cfg.mcp.headers)
    const mcp = { ...cfg.mcp }
    if (cfg.mcp.env) mcp.env = env.record
    if (cfg.mcp.headers) mcp.headers = headers.record
    toWrite = { ...cfg, mcp }
  }
  await writeConfigAtomic(cfg.slug, toWrite)
}

export async function deleteSource(slug: string): Promise<void> {
  const dir = sourceDir(slug)
  try {
    await rm(dir, { recursive: true, force: true })
  } catch (err) {
    if (isMissing(err)) return
    throw err
  }
}

// Line-based parser for guide.md. Extracts the sections agents consume
// (Scope / Guidelines / Context / API Notes) plus a `## Cache` ```json``` block.
// Mirrors Craft's parseGuideMarkdown but avoids its `\Z` anchor (a no-op in JS).
function parseGuide(raw: string): SourceGuide {
  const guide: SourceGuide = { raw }
  const lines = raw.split('\n')
  let current: 'scope' | 'guidelines' | 'context' | 'apinotes' | 'cache' | null = null
  let buf: string[] = []
  const flush = (): void => {
    if (!current) return
    const content = buf.join('\n').trim()
    switch (current) {
      case 'scope':
        guide.scope = content
        break
      case 'guidelines':
        guide.guidelines = content
        break
      case 'context':
        guide.context = content
        break
      case 'apinotes':
        guide.apiNotes = content
        break
      case 'cache': {
        const m = content.match(/```json\n([\s\S]*?)\n```/)
        if (m?.[1]) {
          try {
            guide.cache = JSON.parse(m[1]) as Record<string, unknown>
          } catch {
            // Invalid JSON in the cache block — ignore, leave cache unset.
          }
        }
        break
      }
    }
    buf = []
  }
  for (const line of lines) {
    const h = line.match(/^##[ \t]+(.+?)[ \t]*$/)
    if (h?.[1]) {
      flush()
      const key = h[1].toLowerCase().replace(/\s+/g, '')
      current =
        key === 'scope' ||
        key === 'guidelines' ||
        key === 'context' ||
        key === 'apinotes' ||
        key === 'cache'
          ? key
          : null
      continue
    }
    if (current) buf.push(line)
  }
  flush()
  return guide
}

export async function readGuide(slug: string): Promise<SourceGuide | null> {
  const file = join(sourceDir(slug), GUIDE_FILE)
  try {
    const raw = await readFile(file, 'utf8')
    return parseGuide(raw)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

export async function readPermissions(slug: string): Promise<SourcePermissions | null> {
  const file = join(sourceDir(slug), PERMISSIONS_FILE)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
  try {
    const res = SourcePermissionsSchema.safeParse(JSON.parse(raw) as unknown)
    if (!res.success) {
      log.warn('sources: invalid permissions file', {
        file,
        issues: res.error.issues.map((i) => `${i.path.join('.')}:${i.message}`),
      })
      return null
    }
    return res.data
  } catch (err) {
    log.warn('sources: failed to parse permissions', {
      file,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// Absolute path to the source's local icon file (icon.<ext>) if one exists.
// Config `icon` (emoji / URL) takes precedence upstream; this only surfaces the
// auto-discovered local file.
export async function findSourceIcon(slug: string): Promise<string | undefined> {
  const dir = sourceDir(slug)
  for (const ext of ICON_EXTS) {
    const file = join(dir, `icon.${ext}`)
    try {
      // eslint-disable-next-line no-await-in-loop
      const s = await stat(file)
      if (s.isFile()) return file
    } catch (err) {
      if (!isMissing(err)) throw err
    }
  }
  return undefined
}
