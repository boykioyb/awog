// Nguồn catalog ĐỘNG cho luồng "thêm một connection" — gói #38.
//
// `preset-catalog.ts` là 11 entry hằng-số biên-dịch: muốn thêm/sửa một server
// phải release app mới. Module này lấy danh sách server từ **MCP Registry chính
// thức** (registry.modelcontextprotocol.io — registry công khai do chính dự án
// Model Context Protocol vận hành, không phải marketplace của bên thứ ba), cache
// xuống ~/.awog/ có TTL, và LUÔN degrade về catalog tĩnh khi offline/lỗi. Người
// dùng offline không mất thứ họ đang có.
//
// BẢO MẬT (.claude/rules/security.md) — phần quan trọng nhất của file:
//  #7 SSRF   — chỉ MỘT host được phép (hằng số biên dịch, không lấy từ config /
//              từ payload UI). Ba lớp: ssrfCheck() cho protocol + host literal,
//              so khớp host CHÍNH XÁC, rồi DNS-resolve và kiểm tra lại từng IP
//              (chặn DNS rebinding trỏ registry về mạng nội bộ).
//     Redirect — `redirect: 'manual'`: KHÔNG đi theo redirect, kể cả cùng host.
//              Bất kỳ 3xx nào ⇒ lỗi. Registry trả 200 trực tiếp nên đây là chính
//              sách chặt nhất mà không mất tính năng.
//  L1        — toàn bộ nội dung registry KHÔNG TIN: zod validate, cap byte mỗi
//              trang, cap số trang, cap số entry, timeout, và mọi chuỗi đi vào
//              args/env đều qua regex charset.
//  Thực thi  — registry KHÔNG BAO GIỜ chọn được `command`. Lệnh chạy suy ra từ
//              `registryType` qua một bảng allowlist cứng (npm → npx, pypi →
//              uvx); loại khác ⇒ 'unsupported', chỉ hiện link repo. Một entry độc
//              hại không biến thành lệnh chạy ngầm được.
//  Đồng ý    — module này chỉ TRẢ VỀ bản nháp. Không ghi source, không spawn,
//              không đọc secret. Người dùng thấy đủ command/args/url trong
//              ConnectionEditor rồi tự bấm Save. Draft luôn `enabled: false`.
//  Cache     — đọc lại cache cũng là L1: validate lại bằng đúng schema.

import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises'
import { lookup } from 'node:dns/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { awogHome } from '../util/path.js'
import { log } from '../util/logger.js'
import { blockedHostReason, ssrfCheck } from '../mcp/http-client.js'
import type { McpSource, McpSourceBlock } from '../types/shared.js'
import type { PresetMeta } from './preset-catalog.js'

// ─── Hằng số + cap ──────────────────────────────────────────────────────────

// Host DUY NHẤT được phép. Hằng số biên dịch — không có đường nào cho UI hay
// file config đổi nó, nên bề mặt SSRF là đúng một tên miền.
const REGISTRY_HOST = 'registry.modelcontextprotocol.io'
const REGISTRY_ORIGIN = `https://${REGISTRY_HOST}`
const SERVERS_PATH = '/v0/servers'

// Endpoint `search=` của registry đo được tới ~25s cho truy vấn phổ biến, nên
// 15s cắt nhầm gần hết lượt tìm và đẩy người dùng về bản lọc cục bộ (kém hơn).
const FETCH_TIMEOUT_MS = 30_000
const PAGE_LIMIT = 100
const MAX_PAGES = 5 // ⇒ tối đa 500 entry cho catalog duyệt offline
const MAX_ENTRIES = 500
const SEARCH_LIMIT = 50
const MAX_PAGE_BYTES = 4 * 1024 * 1024 // 4 MB / trang JSON
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_FILE = 'mcp-registry-cache.json'
const CACHE_VERSION = 1

// Cap cho từng mẩu chuỗi đi vào bản nháp.
const MAX_ARGS = 20
const MAX_ENV_KEYS = 20
const MAX_TEXT = 400

// Bảng allowlist: registryType ⇒ lệnh chạy. Registry KHÔNG tự khai `command`.
const RUNTIME_BY_REGISTRY: Record<string, string> = {
  npm: 'npx',
  pypi: 'uvx',
}

// Charset an toàn cho từng mảnh ghép vào args (spawn dạng mảng, không qua shell).
const NPM_IDENT_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
const PYPI_IDENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/
// Giá trị argument: một dòng, không ký tự điều khiển.
// eslint-disable-next-line no-control-regex
const ARG_VALUE_RE = /^[^\x00-\x1f]{1,200}$/

// ─── Kiểu công khai ─────────────────────────────────────────────────────────

// Cách cài một entry. `unsupported` là câu trả lời trung thực cho các registry
// type AWOG không dựng được lệnh an toàn (oci/nuget/mcpb): hiện repo, không đoán.
export type RegistryInstall =
  | { kind: 'remote'; transport: 'http' | 'sse'; url: string; authType: 'bearer' | 'none' }
  | { kind: 'stdio'; command: string; args: string[]; envKeys: string[] }
  | { kind: 'unsupported'; reason: string }

export interface RegistryEntry {
  // `reg:<registry name>` — namespace hoá để không bao giờ đụng id preset tĩnh.
  id: string
  name: string
  title: string
  description: string
  version: string
  updatedAt?: string | undefined
  repositoryUrl?: string | undefined
  install: RegistryInstall
  // Tên env var / header mà entry khai là bí mật + bắt buộc. CHỈ LÀ TÊN — không
  // bao giờ có giá trị. Hiện ở UI để người dùng biết sẽ phải tự điền gì.
  secretFields: string[]
}

// Catalog động lấy từ đâu, còn tươi không. UI hiển thị nguyên trạng để người
// dùng biết mình đang xem dữ liệu nào.
export type RegistryOrigin = 'network' | 'cache' | 'offline'

export interface RegistryResult {
  entries: RegistryEntry[]
  origin: RegistryOrigin
  fetchedAt: number | null
  stale: boolean
  error?: string
}

// ─── Schema L1 cho phản hồi registry ────────────────────────────────────────

const text = (max = MAX_TEXT) => z.string().max(max)

const ArgSchema = z.object({
  type: z.enum(['positional', 'named']).optional(),
  name: text(200).optional(),
  value: text(500).optional(),
  default: text(500).optional(),
})

const VarSchema = z.object({
  name: text(200),
  isRequired: z.boolean().optional(),
  isSecret: z.boolean().optional(),
})

const PackageSchema = z.object({
  registryType: text(50).optional(),
  identifier: text(300).optional(),
  version: text(100).optional(),
  runtimeHint: text(100).optional(),
  transport: z.object({ type: text(50).optional() }).optional(),
  runtimeArguments: z.array(ArgSchema).max(MAX_ARGS).optional(),
  packageArguments: z.array(ArgSchema).max(MAX_ARGS).optional(),
  environmentVariables: z.array(VarSchema).max(50).optional(),
})

const RemoteSchema = z.object({
  type: text(50).optional(),
  url: text(2000),
  headers: z.array(VarSchema).max(50).optional(),
})

const ServerSchema = z.object({
  name: text(300),
  title: text(300).optional(),
  description: text(2000).optional(),
  version: text(100).optional(),
  repository: z.object({ url: text(2000).optional() }).optional(),
  packages: z.array(PackageSchema).max(20).optional(),
  remotes: z.array(RemoteSchema).max(20).optional(),
})

const OfficialMetaSchema = z.object({
  status: text(50).optional(),
  updatedAt: text(100).optional(),
  isLatest: z.boolean().optional(),
})

// Mỗi item là `{ server, _meta }`. Item hỏng bị bỏ ở tầng map, không giết cả trang.
const ItemSchema = z.object({
  server: ServerSchema,
  _meta: z
    .object({ 'io.modelcontextprotocol.registry/official': OfficialMetaSchema.optional() })
    .optional(),
})

const PageSchema = z.object({
  servers: z.array(z.unknown()).max(PAGE_LIMIT * 2),
  metadata: z.object({ nextCursor: text(500).optional() }).optional(),
})

// Cache trên đĩa — đọc lại vẫn là L1 nên phải validate bằng schema riêng.
const InstallSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('remote'),
    transport: z.enum(['http', 'sse']),
    url: text(2000),
    authType: z.enum(['bearer', 'none']),
  }),
  z.object({
    kind: z.literal('stdio'),
    command: text(100),
    args: z.array(text(200)).max(MAX_ARGS),
    envKeys: z.array(text(200)).max(MAX_ENV_KEYS),
  }),
  z.object({ kind: z.literal('unsupported'), reason: text(200) }),
])

const EntrySchema = z.object({
  id: text(400),
  name: text(300),
  title: text(300),
  description: text(2000),
  version: text(100),
  updatedAt: text(100).optional(),
  repositoryUrl: text(2000).optional(),
  install: InstallSchema,
  secretFields: z.array(text(200)).max(MAX_ENV_KEYS),
})

const CacheSchema = z.object({
  version: z.literal(CACHE_VERSION),
  fetchedAt: z.number().int().nonnegative(),
  entries: z.array(EntrySchema).max(MAX_ENTRIES),
})

// ─── HTTP có rào ────────────────────────────────────────────────────────────

// Ba lớp chặn trước khi mở kết nối: protocol/host literal (ssrfCheck), so khớp
// host CHÍNH XÁC với hằng số, rồi DNS-resolve và soi từng IP trả về.
async function assertRegistryUrl(urlStr: string): Promise<void> {
  const guard = ssrfCheck(urlStr)
  if (!guard.ok) throw new Error(`blocked URL: ${guard.reason}`)
  const url = new URL(urlStr)
  if (url.protocol !== 'https:') throw new Error('registry must be https')
  if (url.hostname.toLowerCase() !== REGISTRY_HOST) {
    throw new Error(`host not allowed: ${url.hostname}`)
  }
  let addrs: { address: string }[]
  try {
    addrs = await lookup(url.hostname, { all: true })
  } catch {
    throw new Error(`cannot resolve ${url.hostname}`)
  }
  for (const { address } of addrs) {
    const reason = blockedHostReason(address)
    if (reason) throw new Error(`blocked URL — ${url.hostname} resolves to ${reason}`)
  }
}

// GET một trang registry. `redirect: 'manual'` ⇒ KHÔNG đi theo redirect nào cả:
// một 3xx là lỗi, nên không có đường nào để registry đẩy ta sang host khác.
async function getPage(urlStr: string): Promise<unknown> {
  await assertRegistryUrl(urlStr)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(urlStr, {
      method: 'GET',
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'AWOG-mcp-registry' },
    })
  } catch (err) {
    throw new Error(`network error: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timer)
  }
  if (res.status >= 300 && res.status < 400) throw new Error('registry redirected — refused')
  if (!res.ok) throw new Error(`registry HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > MAX_PAGE_BYTES) throw new Error('registry response too large')
  try {
    return JSON.parse(buf.toString('utf8'))
  } catch {
    throw new Error('registry response is not valid JSON')
  }
}

function pageUrl(params: Record<string, string>): string {
  const url = new URL(SERVERS_PATH, REGISTRY_ORIGIN)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return url.toString()
}

// ─── Map: phản hồi registry ⇒ RegistryEntry ─────────────────────────────────

function argToStrings(a: z.infer<typeof ArgSchema>): string[] {
  const value = a.value ?? a.default
  if (a.type === 'named') {
    if (!a.name || !ARG_VALUE_RE.test(a.name)) return []
    if (value && ARG_VALUE_RE.test(value)) return [a.name, value]
    return [a.name]
  }
  if (!value || !ARG_VALUE_RE.test(value)) return []
  return [value]
}

// Dựng args cho lệnh stdio. Lệnh lấy từ bảng allowlist theo registryType — KHÔNG
// từ `runtimeHint` của registry (đó là chuỗi tự do của bên thứ ba).
function stdioFromPackage(p: z.infer<typeof PackageSchema>): RegistryInstall {
  const registryType = (p.registryType ?? '').toLowerCase()
  const command = RUNTIME_BY_REGISTRY[registryType]
  if (!command) return { kind: 'unsupported', reason: `package type "${registryType || '?'}"` }
  const ident = p.identifier ?? ''
  const identOk = registryType === 'npm' ? NPM_IDENT_RE.test(ident) : PYPI_IDENT_RE.test(ident)
  if (!identOk) return { kind: 'unsupported', reason: 'unsafe package identifier' }
  const version = p.version && VERSION_RE.test(p.version) ? p.version : ''
  const spec = version ? `${ident}@${version}` : ident

  const runtimeArgs = (p.runtimeArguments ?? []).flatMap(argToStrings)
  const packageArgs = (p.packageArguments ?? []).flatMap(argToStrings)
  // `-y` cho npx là mặc định hợp lý khi nguồn không khai: npx hỏi tương tác thì
  // stdio treo. uvx không có cờ tương đương nên để nguyên.
  const prefix = command === 'npx' && !runtimeArgs.includes('-y') ? ['-y'] : []
  const args = [...prefix, ...runtimeArgs, spec, ...packageArgs].slice(0, MAX_ARGS)

  const envKeys = (p.environmentVariables ?? [])
    .map((v) => v.name)
    .filter((n) => ENV_KEY_RE.test(n))
    .slice(0, MAX_ENV_KEYS)
  return { kind: 'stdio', command, args, envKeys }
}

function remoteFromEntry(r: z.infer<typeof RemoteSchema>): RegistryInstall | null {
  const type = (r.type ?? '').toLowerCase()
  const transport =
    type === 'sse' ? 'sse' : type === 'streamable-http' || type === 'http' ? 'http' : null
  if (!transport) return null
  // URL của bên thứ ba: áp cùng chính sách SSRF literal (chặn loopback / IP nội
  // bộ) NGAY LÚC MAP, để một entry trỏ 127.0.0.1 không bao giờ vào được bản nháp.
  const guard = ssrfCheck(r.url)
  if (!guard.ok) return null
  if (new URL(r.url).protocol !== 'https:') return null
  const needsAuth = (r.headers ?? []).some((h) => h.isSecret || h.isRequired)
  return { kind: 'remote', transport, url: r.url, authType: needsAuth ? 'bearer' : 'none' }
}

function toEntry(raw: unknown): RegistryEntry | null {
  const parsed = ItemSchema.safeParse(raw)
  if (!parsed.success) return null
  const s = parsed.data.server
  const meta = parsed.data._meta?.['io.modelcontextprotocol.registry/official']
  if (meta?.status && meta.status !== 'active') return null
  if (meta?.isLatest === false) return null
  if (!s.name) return null

  // Remote trước (không phải cài gì cục bộ), rồi mới tới package stdio.
  let install: RegistryInstall = { kind: 'unsupported', reason: 'no installable package' }
  for (const r of s.remotes ?? []) {
    const hit = remoteFromEntry(r)
    if (hit) {
      install = hit
      break
    }
  }
  if (install.kind === 'unsupported') {
    for (const p of s.packages ?? []) {
      const hit = stdioFromPackage(p)
      install = hit
      if (hit.kind === 'stdio') break
    }
  }

  const secretFields = [
    ...(s.remotes ?? []).flatMap((r) =>
      (r.headers ?? []).filter((h) => h.isSecret).map((h) => h.name),
    ),
    ...(s.packages ?? []).flatMap((p) =>
      (p.environmentVariables ?? []).filter((v) => v.isSecret).map((v) => v.name),
    ),
  ]

  const entry: RegistryEntry = {
    id: `reg:${s.name}`,
    name: s.name,
    title: s.title || s.name.split('/').pop() || s.name,
    description: s.description ?? '',
    version: s.version ?? '',
    install,
    secretFields: [...new Set(secretFields)].slice(0, MAX_ENV_KEYS),
  }
  if (meta?.updatedAt) entry.updatedAt = meta.updatedAt
  if (s.repository?.url) entry.repositoryUrl = s.repository.url
  return entry
}

function mapPage(raw: unknown): { entries: RegistryEntry[]; nextCursor: string } {
  const page = PageSchema.safeParse(raw)
  if (!page.success) throw new Error('registry response shape not recognised')
  const entries: RegistryEntry[] = []
  for (const item of page.data.servers) {
    const e = toEntry(item)
    if (e) entries.push(e)
  }
  return { entries, nextCursor: page.data.metadata?.nextCursor ?? '' }
}

// ─── Cache trên đĩa ─────────────────────────────────────────────────────────

function cachePath(): string {
  return join(awogHome(), CACHE_FILE)
}

async function readCache(): Promise<{ fetchedAt: number; entries: RegistryEntry[] } | null> {
  let body: string
  try {
    body = await readFile(cachePath(), 'utf8')
  } catch {
    return null
  }
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return null
  }
  const parsed = CacheSchema.safeParse(json)
  if (!parsed.success) {
    log.warn('sources: registry cache invalid, ignoring')
    return null
  }
  return { fetchedAt: parsed.data.fetchedAt, entries: parsed.data.entries }
}

async function writeCache(entries: RegistryEntry[], fetchedAt: number): Promise<void> {
  const target = cachePath()
  const tmp = `${target}.tmp`
  try {
    await mkdir(awogHome(), { recursive: true, mode: 0o700 })
    await writeFile(tmp, JSON.stringify({ version: CACHE_VERSION, fetchedAt, entries }), 'utf8')
    await chmod(tmp, 0o600)
    await rename(tmp, target)
  } catch (err) {
    log.warn('sources: cannot write registry cache', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

// ─── Bộ nhớ phiên ───────────────────────────────────────────────────────────

// Mọi entry đã đi qua RPC trong phiên này, keyed theo id. `source.discoverPreset`
// tra ở đây trước khi phải hỏi lại registry: bản nháp người dùng bấm vào phải là
// ĐÚNG cái họ vừa xem, không phải một bản mới tải về sau lưng.
const seen = new Map<string, RegistryEntry>()

function remember(entries: RegistryEntry[]): void {
  for (const e of entries) seen.set(e.id, e)
}

// ─── API công khai ──────────────────────────────────────────────────────────

async function fetchCatalog(): Promise<RegistryEntry[]> {
  const out: RegistryEntry[] = []
  let cursor = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = { limit: String(PAGE_LIMIT), version: 'latest' }
    if (cursor) params.cursor = cursor
    // eslint-disable-next-line no-await-in-loop
    const raw = await getPage(pageUrl(params))
    const { entries, nextCursor } = mapPage(raw)
    out.push(...entries)
    if (out.length >= MAX_ENTRIES || !nextCursor) break
    cursor = nextCursor
  }
  return out.slice(0, MAX_ENTRIES)
}

// Catalog nền để duyệt: mạng → cache → rỗng. KHÔNG bao giờ throw ra ngoài; lỗi
// đi kèm kết quả để UI nói cho người dùng biết mình đang xem dữ liệu nào.
export async function loadCatalog(opts: { refresh?: boolean } = {}): Promise<RegistryResult> {
  const cached = await readCache()
  const fresh = cached !== null && Date.now() - cached.fetchedAt < CACHE_TTL_MS
  if (cached && fresh && !opts.refresh) {
    remember(cached.entries)
    return { entries: cached.entries, origin: 'cache', fetchedAt: cached.fetchedAt, stale: false }
  }
  try {
    const entries = await fetchCatalog()
    const fetchedAt = Date.now()
    await writeCache(entries, fetchedAt)
    remember(entries)
    return { entries, origin: 'network', fetchedAt, stale: false }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn('sources: registry fetch failed, falling back', { err: message })
    if (cached) {
      remember(cached.entries)
      return {
        entries: cached.entries,
        origin: 'cache',
        fetchedAt: cached.fetchedAt,
        stale: true,
        error: message,
      }
    }
    return { entries: [], origin: 'offline', fetchedAt: null, stale: true, error: message }
  }
}

function matches(e: RegistryEntry, needle: string): boolean {
  return (
    e.name.toLowerCase().includes(needle) ||
    e.title.toLowerCase().includes(needle) ||
    e.description.toLowerCase().includes(needle)
  )
}

// Tìm kiếm: ưu tiên hỏi thẳng registry (kho lớn hơn nhiều so với 500 entry đã
// cache); hỏng mạng thì lọc cục bộ trên catalog nền. Cả hai đường đều trả kết
// quả, nên offline vẫn tìm được trong phần đã có.
export async function searchRegistry(query: string): Promise<RegistryResult> {
  const needle = query.trim().toLowerCase()
  if (!needle) return loadCatalog()
  try {
    const raw = await getPage(
      pageUrl({ limit: String(SEARCH_LIMIT), version: 'latest', search: needle }),
    )
    const { entries } = mapPage(raw)
    remember(entries)
    return { entries, origin: 'network', fetchedAt: Date.now(), stale: false }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const base = await loadCatalog()
    return {
      ...base,
      entries: base.entries.filter((e) => matches(e, needle)),
      stale: true,
      error: message,
    }
  }
}

// Tra một entry theo id. Bộ nhớ phiên → cache → hỏi lại registry đúng tên đó.
export async function getRegistryEntry(id: string): Promise<RegistryEntry | null> {
  const hit = seen.get(id)
  if (hit) return hit
  const cached = await readCache()
  const fromCache = cached?.entries.find((e) => e.id === id)
  if (fromCache) {
    seen.set(id, fromCache)
    return fromCache
  }
  const name = id.startsWith('reg:') ? id.slice(4) : ''
  if (!name) return null
  const res = await searchRegistry(name)
  return res.entries.find((e) => e.id === id) ?? null
}

export function isRegistryId(id: string): boolean {
  return id.startsWith('reg:')
}

// ─── Bản nháp ───────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30000

// Slug hợp lệ theo SOURCE_SLUG_RE (^[a-z0-9-]+$). Lấy đoạn cuối của tên
// reverse-DNS vì đó là phần người đọc nhận ra ("io.github.foo/bar" → "bar").
export function registrySlug(name: string): string {
  const tail = name.split('/').pop() ?? name
  const slug = tail
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'mcp-server'
}

// Bản nháp cho ConnectionEditor. KHÔNG bao giờ mang giá trị bí mật: env key được
// gieo RỖNG (người dùng tự điền, giá trị vào OS keychain — invariant #1).
// `enabled: false` LUÔN LUÔN: entry đến từ bên thứ ba nên việc bật là một hành
// động riêng của người dùng, không phải mặc định.
export function buildRegistryDraft(entry: RegistryEntry): McpSource | null {
  const install = entry.install
  if (install.kind === 'unsupported') return null
  const slug = registrySlug(entry.name)
  const mcp: McpSourceBlock =
    install.kind === 'remote'
      ? { transport: install.transport, url: install.url, authType: install.authType }
      : {
          transport: 'stdio',
          command: install.command,
          args: install.args,
          ...(install.envKeys.length
            ? { env: Object.fromEntries(install.envKeys.map((k) => [k, ''])) }
            : {}),
        }
  return {
    id: slug,
    slug,
    name: entry.title,
    provider: slug,
    enabled: false,
    tagline: entry.description.slice(0, 200),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    trust: 'prompt',
    type: 'mcp',
    mcp,
  }
}

// Meta hình-PresetMeta để UI đi chung một đường với catalog tĩnh. `setupHint`
// nói thẳng đây là entry cộng đồng và người dùng phải tự soi command/args/url.
export function registryMeta(entry: RegistryEntry): PresetMeta {
  const needs = entry.secretFields.length ? ` You will need to set: ${entry.secretFields.join(', ')}.` : ''
  const hint =
    entry.install.kind === 'stdio'
      ? `Community entry from the MCP Registry (${entry.name}). Review the command and arguments below before saving — nothing runs until you save and test it.${needs}`
      : `Community entry from the MCP Registry (${entry.name}). Review the URL below before saving — nothing connects until you save and test it.${needs}`
  return {
    id: entry.id,
    slug: registrySlug(entry.name),
    name: entry.title,
    provider: registrySlug(entry.name),
    type: 'mcp',
    tagline: entry.description.slice(0, 200),
    setupHint: hint,
  }
}
