// MCP server config persistence. One file per server at
// ~/.awog/mcp-servers/<id>.json — see ADR 0014. Pattern mirrors
// projects/store.ts: atomic rewrite via .tmp + rename, delete = unlink.

import { mkdir, readdir, readFile, writeFile, chmod, rename, unlink } from 'node:fs/promises'
import { basename as pathBasename, join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { McpServerConfigSchema } from './schema.js'
import type { McpServerConfig } from '../types/shared.js'

const DIR_NAME = sanitizeChild('mcp-servers')

function dir(): string {
  return join(awogHome(), DIR_NAME)
}

function fileFor(id: string): string {
  const safe = sanitizeChild(id)
  return join(dir(), `${safe}.json`)
}

async function ensureDir(): Promise<void> {
  await mkdir(dir(), { recursive: true, mode: 0o700 })
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

function parse(raw: string, file: string): McpServerConfig | null {
  try {
    const obj = JSON.parse(raw) as unknown
    // Filename is the source of truth for id. If the config omits it (LLM
    // author / hand-edit), backfill so the file isn't silently dropped.
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
    const res = McpServerConfigSchema.safeParse(obj)
    if (!res.success) {
      log.warn('mcp: invalid config file', {
        file,
        issues: res.error.issues.map((i) => `${i.path.join('.')}:${i.message}`),
      })
      return null
    }
    return res.data
  } catch (err) {
    log.warn('mcp: failed to parse', {
      file,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

export async function loadServer(id: string): Promise<McpServerConfig | null> {
  const file = fileFor(id)
  try {
    const raw = await readFile(file, 'utf8')
    return parse(raw, file)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

export async function listServers(): Promise<McpServerConfig[]> {
  let entries: string[]
  try {
    entries = await readdir(dir())
  } catch (err) {
    if (isMissing(err)) return []
    throw err
  }
  const out: McpServerConfig[] = []
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    const file = join(dir(), name)
    try {
      // eslint-disable-next-line no-await-in-loop
      const raw = await readFile(file, 'utf8')
      const snap = parse(raw, file)
      if (snap) out.push(snap)
    } catch (err) {
      log.warn('mcp: failed to read file', {
        file,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id))
  return out
}

export async function saveServer(server: McpServerConfig): Promise<void> {
  await ensureDir()
  const file = fileFor(server.id)
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(server, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

export async function deleteServer(id: string): Promise<void> {
  const file = fileFor(id)
  try {
    await unlink(file)
  } catch (err) {
    if (isMissing(err)) return
    throw err
  }
}
