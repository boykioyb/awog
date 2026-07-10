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
const ICON_EXTS = ['svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'ico'] as const
type IconExt = (typeof ICON_EXTS)[number]

// Per-extension MIME used to build a `data:` URI for the renderer (base64 img).
const ICON_EXT_MIME: Record<IconExt, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  ico: 'image/x-icon',
}

// Data-URI size cap (raw bytes). A single small avatar icon is well under this;
// anything larger is rejected so a bad file can't bloat the RPC payload / store.
const ICON_MAX_BYTES = 512 * 1024

// guide.md write cap (raw UTF-8 bytes). Documentation is authored prose — a
// generous cap that still keeps a runaway paste from bloating the store / RPC.
const GUIDE_MAX_BYTES = 256 * 1024

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

// Atomic text write (.tmp + rename). No chmod 0600 — guide.md / permissions.json
// carry no credentials (unlike config.json), so they use the same relaxed mode as
// the icon writer. The dir is created 0700 by the config path; ensure it here too
// for a source whose guide/permissions are saved before any config write.
async function writeTextAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, file)
}

// Save (or clear) guide.md for a source. Empty / whitespace-only content DELETES
// the file rather than leaving a zero-byte guide behind — a source with no
// guide.md is the canonical "no documentation" state (readGuide → null), so the
// UI's empty state stays consistent. Byte-cap is enforced by the RPC layer.
export async function saveGuide(slug: string, content: string): Promise<void> {
  const file = join(sourceDir(slug), GUIDE_FILE)
  if (content.trim() === '') {
    await rm(file, { force: true })
    return
  }
  await mkdir(sourceDir(slug), { recursive: true, mode: 0o700 })
  await writeTextAtomic(file, content)
}

// Save permissions.json for a source. The caller (RPC) validates the shape with
// SourcePermissionsSchema before this runs; here we only persist the pretty JSON.
// No secret — permission patterns are scoping rules, never credentials.
export async function savePermissions(slug: string, permissions: SourcePermissions): Promise<void> {
  await mkdir(sourceDir(slug), { recursive: true, mode: 0o700 })
  const file = join(sourceDir(slug), PERMISSIONS_FILE)
  await writeTextAtomic(file, JSON.stringify(permissions, null, 2))
}

// Absolute path + extension of the source's local icon file (icon.<ext>) if one
// exists. Config `icon` (emoji / URL) takes precedence upstream; this only
// surfaces the auto-discovered local file.
export async function findSourceIcon(
  slug: string,
): Promise<{ path: string; ext: IconExt } | undefined> {
  const dir = sourceDir(slug)
  for (const ext of ICON_EXTS) {
    const file = join(dir, `icon.${ext}`)
    try {
      // eslint-disable-next-line no-await-in-loop
      const s = await stat(file)
      if (s.isFile()) return { path: file, ext }
    } catch (err) {
      if (!isMissing(err)) throw err
    }
  }
  return undefined
}

// Read the source's local icon file (if any) and encode it as a `data:` URI for
// the renderer. Returns null when there is no icon file OR the file exceeds the
// size cap (a too-large file is not partially read). Never throws on a missing
// file. The bytes live entirely inside ~/.awog/sources — trusted, non-secret.
export async function readSourceIconDataUri(slug: string): Promise<string | null> {
  const found = await findSourceIcon(slug)
  if (!found) return null
  const st = await stat(found.path)
  if (st.size > ICON_MAX_BYTES) {
    log.warn('sources: icon exceeds size cap, skipping', { slug, size: st.size })
    return null
  }
  const buf = await readFile(found.path)
  return `data:${ICON_EXT_MIME[found.ext]};base64,${buf.toString('base64')}`
}

// Cache a downloaded icon into the source folder as icon.<ext> (atomic write via
// a .tmp + rename). Non-secret content, so no chmod 0600 (unlike config.json).
// `ext` must be one of the recognized icon extensions.
export async function writeSourceIcon(slug: string, ext: IconExt, data: Buffer): Promise<void> {
  await mkdir(sourceDir(slug), { recursive: true, mode: 0o700 })
  const file = join(sourceDir(slug), `icon.${ext}`)
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, data)
  await rename(tmp, file)
}

export { ICON_EXTS, ICON_EXT_MIME, ICON_MAX_BYTES, GUIDE_MAX_BYTES }
export type { IconExt }
