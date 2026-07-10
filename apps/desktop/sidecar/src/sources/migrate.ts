// One-time boot migration: legacy MCP server configs
// (~/.awog/mcp-servers/<id>.json) → per-source folders
// (~/.awog/sources/<slug>/config.json) with type:'mcp'. See ADR 0060.
//
// Safety contract (P0):
//   - COPY-based: the legacy mcp-servers/ dir is never moved or deleted.
//   - BACKUP once: the whole dir is copied to mcp-servers.backup/ before the
//     first write, so a bad migration can be reverted by hand.
//   - IDEMPOTENT: a done-flag short-circuits later boots, and each source is
//     skipped if its config.json already exists.
//   - NEVER touches the keychain: `secret:KEY` env/header refs are carried over
//     verbatim (the source keeps the old MCP id, so the account `<id>/<key>`
//     still resolves).

import { readdir, readFile, writeFile, chmod, rename, mkdir, stat, cp } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { awogHome } from '../util/path.js'
import { log } from '../util/logger.js'
import { McpServerConfigSchema } from '../mcp/schema.js'
import { SourceConfigSchema } from './schema.js'
import type { McpServerConfig, McpSource, McpSourceBlock } from '../types/shared.js'

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch (err) {
    if (isMissing(err)) return false
    throw err
  }
}

// Map a legacy MCP server config onto an mcp Source. The MCP `id` is preserved
// as both the source id and the folder slug (a legacy id is always a valid
// slug), so keychain lookups keyed on `<id>/<key>` keep resolving. `command`,
// `args`, `env` and `cwd` fold into the stdio block; `url` and `headers` fold
// into the http/sse block. Secret refs are copied untouched.
function mapServerToSource(server: McpServerConfig): McpSource {
  const now = Date.now()
  const mcp: McpSourceBlock = { transport: server.transport }
  if (server.transport === 'stdio') {
    if (server.command !== undefined) mcp.command = server.command
    if (server.args !== undefined) mcp.args = server.args
    if (server.env !== undefined) mcp.env = server.env
    if (server.cwd !== undefined) mcp.cwd = server.cwd
  } else {
    if (server.url !== undefined) mcp.url = server.url
    if (server.headers !== undefined) mcp.headers = server.headers
  }

  const cfg: McpSource = {
    id: server.id,
    slug: server.id,
    name: server.name,
    // provider is a freeform label; the id/slug is the most faithful carry-over
    // (there is no provider concept in the legacy MCP config).
    provider: server.id,
    enabled: server.enabled,
    type: 'mcp',
    timeoutMs: server.timeoutMs,
    trust: server.trust,
    createdAt: now,
    updatedAt: now,
    mcp,
  }
  if (server.description) cfg.description = server.description
  if (server.deniedTools) cfg.deniedTools = server.deniedTools
  if (server.healthCheck) cfg.healthCheck = server.healthCheck
  return cfg
}

// Parse a legacy config, backfilling `id` from the filename when omitted
// (mirrors mcp/store.ts parse). Returns null on invalid JSON / schema.
function parseServer(raw: string, file: string): McpServerConfig | null {
  try {
    const obj = JSON.parse(raw) as unknown
    if (
      obj &&
      typeof obj === 'object' &&
      !Array.isArray(obj) &&
      typeof (obj as { id?: unknown }).id !== 'string'
    ) {
      const name = basename(file)
      const derived = name.endsWith('.json') ? name.slice(0, -5) : name
      if (derived) (obj as { id: string }).id = derived
    }
    const res = McpServerConfigSchema.safeParse(obj)
    if (!res.success) {
      log.warn('sources/migrate: invalid legacy config, skipping', {
        file,
        issues: res.error.issues.map((i) => `${i.path.join('.')}:${i.message}`),
      })
      return null
    }
    return res.data
  } catch (err) {
    log.warn('sources/migrate: failed to parse legacy config, skipping', {
      file,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

async function writeSourceConfig(targetDir: string, cfg: McpSource): Promise<void> {
  await mkdir(targetDir, { recursive: true, mode: 0o700 })
  const target = join(targetDir, 'config.json')
  const tmp = `${target}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(cfg, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, target)
}

// `baseDir` is injectable purely so the migration can be exercised against a
// fixture dir in tests; production always passes the real AWOG home.
export async function migrateMcpServersToSources(baseDir: string = awogHome()): Promise<void> {
  const mcpDir = join(baseDir, 'mcp-servers')
  const sourcesDir = join(baseDir, 'sources')
  const backupDir = join(baseDir, 'mcp-servers.backup')
  const doneFlag = join(sourcesDir, '.mcp-servers-migrated')

  // Idempotency guard #1: a completed pass short-circuits every later boot.
  if (await pathExists(doneFlag)) return

  let files: string[]
  try {
    files = (await readdir(mcpDir)).filter((n) => n.endsWith('.json'))
  } catch (err) {
    if (isMissing(err)) return // no legacy dir → nothing to migrate
    throw err
  }
  if (files.length === 0) return

  // Back up the legacy dir ONCE before any write (copy, never move).
  if (!(await pathExists(backupDir))) {
    await cp(mcpDir, backupDir, { recursive: true })
    log.info('sources/migrate: backed up legacy mcp-servers dir', { from: mcpDir, to: backupDir })
  }

  let migrated = 0
  let skipped = 0
  let failed = 0
  for (const name of files) {
    const file = join(mcpDir, name)
    let raw: string
    try {
      // eslint-disable-next-line no-await-in-loop
      raw = await readFile(file, 'utf8')
    } catch (err) {
      failed++
      log.warn('sources/migrate: failed to read legacy config', {
        file,
        err: err instanceof Error ? err.message : String(err),
      })
      continue
    }
    const server = parseServer(raw, file)
    if (!server) {
      failed++
      continue
    }

    const slug = server.id
    const targetDir = join(sourcesDir, slug)
    // Idempotency guard #2: never overwrite an existing source.
    // eslint-disable-next-line no-await-in-loop
    if (await pathExists(join(targetDir, 'config.json'))) {
      skipped++
      continue
    }

    const cfg = mapServerToSource(server)
    // Defensive: never write a config the loader would reject.
    const check = SourceConfigSchema.safeParse(cfg)
    if (!check.success) {
      failed++
      log.warn('sources/migrate: mapped config failed validation, skipping', {
        id: server.id,
        issues: check.error.issues.map((i) => `${i.path.join('.')}:${i.message}`),
      })
      continue
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      await writeSourceConfig(targetDir, cfg)
      migrated++
      log.info('sources/migrate: migrated mcp server → source', {
        id: server.id,
        slug,
        transport: server.transport,
      })
    } catch (err) {
      failed++
      log.warn('sources/migrate: failed to write source config', {
        id: server.id,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Mark done so subsequent boots are a no-op (guard #1). Best-effort — if this
  // fails the per-source existence check (guard #2) still prevents duplicates.
  try {
    await mkdir(sourcesDir, { recursive: true, mode: 0o700 })
    await writeFile(doneFlag, `migrated ${new Date().toISOString()}\n`, 'utf8')
  } catch (err) {
    log.warn('sources/migrate: failed to write done-flag', {
      err: err instanceof Error ? err.message : String(err),
    })
  }

  log.info('sources/migrate: complete', { total: files.length, migrated, skipped, failed })
}
