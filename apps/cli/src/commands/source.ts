// `awog source …` (alias: `awog mcp …`) — set up MCP/API/local sources from the
// terminal. Writes go to ~/.awog/sources/<slug>/config.json via source.upsert;
// secrets never touch the file — source.setSecret stores them in the OS
// keychain and we put `secret:KEY` refs into env/headers like the UI does.

import type { Engine } from '../transport.js'
import { askLine, isTTY, note, sgr, table } from '../tty.js'

interface SourceConfig {
  id: string
  slug: string
  name: string
  provider: string
  type: 'mcp' | 'api' | 'local'
  enabled: boolean
  trust: 'allow' | 'prompt' | 'deny'
  timeoutMs: number
  connectionStatus?: string
  connectionError?: string
  mcp?: Record<string, unknown>
  api?: Record<string, unknown>
  local?: Record<string, unknown>
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!s) throw new Error('slug needs at least one [a-z0-9] character')
  return s
}

/** `K=V;K2=V2` → record. A lone `KEY` (no =) means "prompt for the secret". */
function parsePairs(raw: string | undefined): { plain: Record<string, string>; secretKeys: string[] } {
  const plain: Record<string, string> = {}
  const secretKeys: string[] = []
  for (const part of (raw ?? '').split(';')) {
    const kv = part.trim()
    if (!kv) continue
    const eq = kv.indexOf('=')
    if (eq < 0) secretKeys.push(kv)
    else plain[kv.slice(0, eq)] = kv.slice(eq + 1)
  }
  return { plain, secretKeys }
}

export async function cmdSourceLs(engine: Engine, json: boolean): Promise<void> {
  const res = await engine.rpc<{ sources?: SourceConfig[] }>('source.list')
  const sources = res.sources ?? []
  if (json) {
    process.stdout.write(`${JSON.stringify(sources, null, 2)}\n`)
    return
  }
  const rows = sources.map((s) => [
    s.enabled ? sgr.ok('●') : sgr.dim('○'),
    s.slug,
    s.type,
    s.connectionStatus === 'connected'
      ? sgr.ok('connected')
      : s.connectionStatus === 'failed'
        ? sgr.err('failed')
        : sgr.dim(s.connectionStatus ?? 'untested'),
    s.name,
  ])
  process.stdout.write(
    `${table(['', 'SLUG', 'TYPE', 'STATUS', 'NAME'], rows, [1, 18, 6, 12, 'flex'])}\n`,
  )
  note(`${sgr.accent('·')} ${sgr.dim(`${sources.length} source(s)`)}`)
}

export interface SourceAddFlags {
  type?: string | undefined // mcp (default) | api | local
  // mcp transport
  stdio?: boolean
  url?: string | undefined // → http transport
  command?: string | undefined
  args?: string | undefined // space-split
  cwd?: string | undefined
  env?: string | undefined // K=V;K2=V2 — bare K prompts for a keychain secret
  headers?: string | undefined // same grammar, for http
  bearer?: string | undefined // token value → header Authorization, keychainized
  // api
  baseUrl?: string | undefined
  // local
  path?: string | undefined
  // common
  name?: string | undefined
  trust?: string | undefined
  enabled?: boolean
}

export async function cmdSourceAdd(
  engine: Engine,
  slugArg: string,
  f: SourceAddFlags,
): Promise<void> {
  const slug = slugify(slugArg)
  const type = (f.type ?? 'mcp') as SourceConfig['type']
  const now = Date.now()
  const id = `${slug}_${Math.random().toString(16).slice(2, 10)}`

  const base = {
    id,
    slug,
    name: f.name ?? slugArg,
    provider: 'custom',
    enabled: f.enabled ?? true,
    trust: (f.trust ?? 'prompt') as SourceConfig['trust'],
    timeoutMs: 30_000,
    createdAt: now,
    updatedAt: now,
  }

  let source: SourceConfig
  const secretQueue: string[] = [] // keys to keychainize after upsert

  if (type === 'mcp') {
    const isHttp = f.url !== undefined && !f.stdio
    if (isHttp) {
      const { plain: headers, secretKeys } = parsePairs(f.headers)
      secretQueue.push(...secretKeys.map((k) => `header:${k}`))
      const hRec: Record<string, string> = { ...headers }
      for (const k of secretKeys) hRec[k] = `secret:${k}`
      source = {
        ...base,
        type,
        mcp: {
          transport: 'http',
          url: f.url,
          authType: f.bearer ? 'bearer' : 'none',
          ...(Object.keys(hRec).length ? { headers: hRec } : {}),
          ...(f.bearer
            ? {
                headers: {
                  ...hRec,
                  Authorization: `Bearer secret:MCP_TOKEN`,
                },
              }
            : {}),
        },
      }
      if (f.bearer) secretQueue.push('header:MCP_TOKEN')
    } else {
      if (!f.command) throw new Error('stdio source needs --command (or pass --url for http)')
      const { plain: env, secretKeys } = parsePairs(f.env)
      const eRec: Record<string, string> = { ...env }
      for (const k of secretKeys) {
        eRec[k] = `secret:${k}`
        secretQueue.push(`env:${k}`)
      }
      source = {
        ...base,
        type,
        mcp: {
          transport: 'stdio',
          command: f.command,
          args: f.args ? f.args.split(/\s+/).filter(Boolean) : [],
          ...(Object.keys(eRec).length ? { env: eRec } : {}),
          ...(f.cwd ? { cwd: f.cwd } : {}),
        },
      }
    }
  } else if (type === 'api') {
    if (!f.baseUrl) throw new Error('api source needs --base-url')
    source = {
      ...base,
      type,
      api: { baseUrl: f.baseUrl, authType: 'none' },
    }
  } else {
    if (!f.path) throw new Error('local source needs --path')
    source = { ...base, type, local: { path: f.path } }
  }

  await engine.rpc('source.upsert', { mode: 'create', source })
  note(
    `${sgr.accent('·')} source ${sgr.bold(slug)} created (${(source.mcp?.transport as string | undefined) ?? type})`,
  )

  // Secrets: values never hit the config file — keychain + `secret:KEY` ref.
  for (const ref of secretQueue) {
    const key = ref.split(':')[1]!
    let value: string | undefined
    if (key === 'MCP_TOKEN' && f.bearer) value = f.bearer
    if (!value) {
      if (!isTTY()) {
        note(`${sgr.warn('·')} ${key} left unset — run: awog source secret ${slug} ${key}`)
        continue
      }
      value = (await askLine(`  secret ${sgr.bold(key)}: `)).trim()
    }
    if (!value) continue
    await engine.rpc('source.setSecret', { sourceId: id, key, value })
    note(`  ${sgr.ok('✓')} ${key} → keychain`)
  }
  if (isTTY() && type === 'mcp') {
    const go = (await askLine(`  test ${slug} now? [Y/n] `)).trim().toLowerCase()
    if (go !== 'n' && go !== 'no') await cmdSourceTest(engine, slug)
  }
}

export async function cmdSourceRm(engine: Engine, slug: string): Promise<void> {
  await engine.rpc('source.delete', { slug })
  note(`${sgr.accent('·')} source ${sgr.bold(slug)} deleted`)
}

export async function cmdSourceToggle(
  engine: Engine,
  slug: string,
  enabled: boolean,
): Promise<void> {
  await engine.rpc('source.toggle', { slug, enabled })
  note(`${sgr.accent('·')} ${sgr.bold(slug)} ${enabled ? sgr.ok('enabled') : sgr.dim('disabled')}`)
}

export async function cmdSourceSecret(
  engine: Engine,
  slug: string,
  key: string,
  value: string | undefined,
): Promise<void> {
  const res = await engine.rpc<{ source?: SourceConfig }>('source.get', { slug })
  const source = res.source
  if (!source) throw new Error(`source not found: ${slug}`)
  const v =
    value ??
    (isTTY()
      ? (await askLine(`  secret ${sgr.bold(key)}: `)).trim()
      : '')
  if (!v) throw new Error('empty secret')
  await engine.rpc('source.setSecret', { sourceId: source.id, key, value: v })
  note(`${sgr.ok('✓')} ${key} → keychain for ${sgr.bold(slug)}`)
}

export async function cmdSourceTest(engine: Engine, slug: string): Promise<void> {
  const res = await engine.rpc<{
    source?: SourceConfig
    outcome?: { supported?: boolean; ok?: boolean; error?: string; toolCount?: number }
  }>('source.test', { slug })
  const o = res.outcome
  if (o?.ok) {
    note(
      `${sgr.ok('✓')} ${sgr.bold(slug)} connected${o.toolCount !== undefined ? sgr.dim(` — ${o.toolCount} tool(s)`) : ''}`,
    )
  } else {
    note(`${sgr.err('✗')} ${sgr.bold(slug)} — ${sgr.dim(o?.error ?? 'test failed')}`)
    process.exitCode = 1
  }
}

export async function cmdSourceTools(engine: Engine, slug: string): Promise<void> {
  const res = await engine.rpc<{ tools?: Array<{ name?: string; description?: string }> }>(
    'source.tools',
    { slug },
  )
  const tools = res.tools ?? []
  const rows = tools.map((t) => [t.name ?? '', t.description ?? ''])
  process.stdout.write(`${table(['TOOL', 'DESCRIPTION'], rows, [32, 'flex'])}\n`)
  note(`${sgr.accent('·')} ${sgr.dim(`${tools.length} tool(s) on ${slug}`)}`)
}
