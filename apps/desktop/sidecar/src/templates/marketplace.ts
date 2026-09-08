// Danh mục template cài được — gói #37 ("tìm plugin/skill từ registry rồi cài").
//
// Trước gói này, đường vào DUY NHẤT của một template từ xa là tự dán URL GitHub
// (`templates.fetchRemote`, ADR 0037): người dùng phải biết trước cái link. Module
// này thêm một danh mục để DUYỆT, nhưng không đổi cách cài — cài vẫn đi qua đúng
// lớp `remote.ts` đã có (plan → tải → ghi staging → swap), nên mọi cap/guard của
// nó áp nguyên vẹn.
//
// NGUỒN DANH MỤC. Không có registry chính thức cho template/plugin của AWOG (khác
// MCP — nó có registry.modelcontextprotocol.io do chính dự án MCP vận hành). Nên
// AWOG tự công bố một danh mục ở **một repo cố định**, đọc qua raw.githubusercontent
// .com với owner/repo/ref/path là HẰNG SỐ BIÊN DỊCH:
//
//     https://raw.githubusercontent.com/<OWNER>/<REPO>/<REF>/catalog.json
//
// Đánh đổi, nói thẳng:
//  + Bề mặt SSRF là ĐÚNG MỘT tên miền, y hệt `sources/registry.ts`. Không setting
//    nào, không payload UI nào đổi được nó.
//  + Công bố template mới = sửa một file trong repo đó, KHÔNG cần release app —
//    đây chính là thứ catalog hằng-số-biên-dịch không làm được.
//  − Tập trung: chỉ AWOG thêm được entry. Đây là danh mục **được tuyển**, không
//    phải marketplace mở. Ai muốn phát hành ngoài danh mục vẫn dùng "Lấy từ
//    GitHub" như cũ (đường đó không mất đi).
//  − Repo danh mục thành một điểm tin cậy. Vì vậy danh mục **không bao giờ**
//    quyết định được thứ gì chạy: entry chỉ mang metadata + một URL github.com;
//    nội dung thật đọc từ `template.json` của chính bundle, và người dùng phải
//    duyệt danh sách entity thật trước khi ghi (xem phần Đồng ý).
//  ~ Phương án đã cân nhắc và bỏ: tìm repo theo topic qua api.github.com/search
//    (phi tập trung, ai cũng phát hành được) — nhưng không có tuyển chọn nào, rate
//    limit 10 req/phút khi không đăng nhập, và kết quả là repo bất kỳ của người lạ
//    hiện ra như thể AWOG giới thiệu. Chưa đáng đổi.
//
// BẢO MẬT (.claude/rules/security.md):
//  #7 SSRF   — ba lớp như registry.ts: ssrfCheck() → so hostname CHÍNH XÁC với
//              hằng số → dns.lookup và kiểm TỪNG IP (chặn DNS rebinding).
//     Redirect — `redirect: 'manual'`: mọi 3xx là lỗi. catalog.json nhỏ nên raw
//              trả 200 trực tiếp; đây là chính sách chặt nhất mà không mất gì.
//  L1        — danh mục KHÔNG TIN: zod, cap byte, cap số entry, timeout, và URL
//              của từng entry phải là thứ CHÍNH `parseGithubUrl` (lớp cài) giải
//              được — kiểm ngay lúc map bằng đúng hàm đó, entry hỏng bị LOẠI +
//              log thay vì hiện ra rồi hỏng lúc cài. `homepage` là link UI biến
//              thành cú bấm mở trình duyệt: bắt buộc https + qua `ssrfCheck`,
//              hỏng thì RỤNG RIÊNG field (entry vẫn sống) — xem `safeHomepage`.
//  Cache     — đọc lại cache cũng là L1: validate lại bằng đúng schema.
//  Đồng ý    — cài PHẢI kèm `token` lấy từ `inspect`. Token là băm của kế hoạch
//              (danh sách entity + từng file + blob sha). Nguồn đổi nội dung giữa
//              lúc người dùng đọc màn hình đồng ý và lúc bấm Cài ⇒ token lệch ⇒
//              engine TỪ CHỐI ghi và trả về bản kiểm tra mới. Ràng buộc nằm ở
//              engine, không phải ở UI, nên không vẽ lại giao diện là lách được.
//  Thực thi  — cài = ghi bundle vào ~/.awog/templates/. KHÔNG entity nào vào
//              project, KHÔNG hook nào chạy. Hook chỉ tới được trạng thái chạy
//              được sau `templates.install` (ghi vào tier project ⇒ untrusted) và
//              một lần người dùng duyệt trust riêng (ADR 0032 D-8).

import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import { awogHome } from '../util/path.js'
import { blockedHostReason, ssrfCheck } from '../mcp/http-client.js'
import { baselineFromDisk, entityKeyOf, type InstalledTemplate } from './install-meta.js'
import {
  bundleUrl,
  downloadFilesInto,
  finalizeBundleDir,
  planSingleBundle,
  tryParseGithubUrl,
  type PlannedBundle,
  type RepoRef,
} from './remote.js'
import { getTemplate, stagingDir, swapBundle, templateDir } from './store.js'
import type { ConfigKind, ProjectTemplate, TemplateEntityRef } from '../types/shared.js'

// ─── Hằng số + cap ──────────────────────────────────────────────────────────

// Host DUY NHẤT được phép cho danh mục. Hằng số biên dịch.
const CATALOG_HOST = 'raw.githubusercontent.com'
const CATALOG_OWNER = 'boykioyb'
const CATALOG_REPO = 'awog-templates'
const CATALOG_REF = 'main'
const CATALOG_FILE = 'catalog.json'

const FETCH_TIMEOUT_MS = 15_000
// Export để test kiểm được đúng trần mà `getCatalogDoc` áp, thay vì chép lại số.
export const MAX_CATALOG_BYTES = 512 * 1024
const MAX_ENTRIES = 300
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_FILE = 'template-catalog-cache.json'
const CACHE_VERSION = 1

const KINDS = ['agent', 'skill', 'hook', 'rule', 'command'] as const

// ─── Kiểu công khai ─────────────────────────────────────────────────────────

export interface MarketplaceEntry {
  id: string
  name: string
  description: string
  author: string
  version: string
  // URL folder bundle trên github.com. Lúc map đã cho chạy qua chính
  // `parseGithubUrl` của lớp cài, nên entry còn ở đây là entry `planSingleBundle`
  // giải được — nó sẽ parse lại đúng hàm đó lúc cài.
  url: string
  // Loại entity mà LISTING KHAI — chỉ để lọc/hiện nhãn. KHÔNG phải sự thật:
  // sự thật đọc từ template.json của bundle ở bước `inspect`.
  kinds: ConfigKind[]
  tags: string[]
  homepage?: string
}

export type CatalogOrigin = 'network' | 'cache' | 'offline'

export interface MarketplaceResult {
  entries: MarketplaceEntry[]
  origin: CatalogOrigin
  fetchedAt: number | null
  stale: boolean
  error?: string
}

// Những gì người dùng PHẢI thấy trước khi bundle được ghi xuống đĩa.
export interface MarketplaceInspection {
  entryId: string
  templateId: string
  name: string
  description: string
  version?: string
  sourceUrl: string
  sourceRef: string
  // Toàn bộ entity bundle sẽ ghi — đọc từ template.json của chính bundle.
  entities: TemplateEntityRef[]
  fileCount: number
  totalBytes: number
  // Loại entity bundle THẬT SỰ chứa mà listing không khai. Đúng cái bẫy của một
  // danh mục: mô tả "chỉ vài rule" nhưng bên trong có hook chạy shell.
  undisclosedKinds: ConfigKind[]
  alreadyInstalled: boolean
  // Băm của kế hoạch. Phải gửi lại nguyên văn khi cài.
  token: string
}

export type MarketplaceInstallResult =
  | { status: 'installed'; template: InstalledTemplate }
  | { status: 'exists'; templateId: string }
  // Nguồn đã đổi kể từ lúc người dùng đọc màn hình đồng ý ⇒ không ghi gì, trả về
  // bản kiểm tra mới để hỏi lại.
  | { status: 'changed'; inspection: MarketplaceInspection }

// ─── Schema L1 ──────────────────────────────────────────────────────────────

const text = (max: number) => z.string().max(max)

const EntrySchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  description: text(2000).optional(),
  author: text(200).optional(),
  version: text(120).optional(),
  url: z.string().min(1).max(2048),
  kinds: z.array(z.enum(KINDS)).max(KINDS.length).optional(),
  tags: z.array(text(60)).max(20).optional(),
  homepage: text(2048).optional(),
})

const CatalogSchema = z.object({
  version: z.number().int().optional(),
  templates: z.array(z.unknown()).max(MAX_ENTRIES * 2),
})

// Cache trên đĩa dùng dạng đã map (đúng `MarketplaceEntry`) — vẫn là L1.
const CachedEntrySchema = z.object({
  id: text(120),
  name: text(200),
  description: text(2000),
  author: text(200),
  version: text(120),
  url: text(2048),
  kinds: z.array(z.enum(KINDS)).max(KINDS.length),
  tags: z.array(text(60)).max(20),
  homepage: text(2048).optional(),
})

const CacheSchema = z.object({
  version: z.literal(CACHE_VERSION),
  fetchedAt: z.number().int().nonnegative(),
  entries: z.array(CachedEntrySchema).max(MAX_ENTRIES),
})

// ─── HTTP có rào ────────────────────────────────────────────────────────────

function catalogUrl(): string {
  return `https://${CATALOG_HOST}/${CATALOG_OWNER}/${CATALOG_REPO}/${CATALOG_REF}/${CATALOG_FILE}`
}

// Ba lớp chặn trước khi mở kết nối — giống hệt `sources/registry.ts`, cố ý không
// phát minh cách thứ hai.
async function assertCatalogUrl(urlStr: string): Promise<void> {
  const guard = ssrfCheck(urlStr)
  if (!guard.ok) throw new Error(`blocked URL: ${guard.reason}`)
  const url = new URL(urlStr)
  if (url.protocol !== 'https:') throw new Error('catalog must be https')
  if (url.hostname.toLowerCase() !== CATALOG_HOST) {
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

async function getCatalogDoc(): Promise<unknown> {
  const urlStr = catalogUrl()
  await assertCatalogUrl(urlStr)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(urlStr, {
      method: 'GET',
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'AWOG-template-catalog' },
    })
  } catch (err) {
    throw new Error(`network error: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timer)
  }
  if (res.status >= 300 && res.status < 400) throw new Error('catalog redirected — refused')
  if (res.status === 404) throw new Error('catalog not published yet')
  if (!res.ok) throw new Error(`catalog HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > MAX_CATALOG_BYTES) throw new Error('catalog response too large')
  try {
    return JSON.parse(buf.toString('utf8'))
  } catch {
    throw new Error('catalog is not valid JSON')
  }
}

// ─── Map danh mục ───────────────────────────────────────────────────────────

// URL của entry là L1. Kiểm ngay lúc map để một entry KHÔNG CÀI ĐƯỢC không bao
// giờ hiện ra trong danh sách. Trả lý do (null = dùng được) để chỗ loại còn nói
// được vì sao.
//
// Đúng MỘT luật được viết ở đây — "https": danh mục siết chặt hơn
// `parseGithubUrl` (hàm đó còn nhận http) vì entry đi qua đây là thứ AWOG tự
// tuyển, không có cớ nào để rơi xuống http. Phần còn lại — host github.com, dạng
// `/tree/<ref>/<dir>`, ký tự cho phép trong owner/repo/ref/path — KHÔNG chép lại
// mà hỏi thẳng `tryParseGithubUrl`, tức CHÍNH hàm mà nút Cài sẽ chạy. Trước đây
// chỗ này chỉ so host, nên một url `/blob/main/x` đi lọt danh mục rồi mới chết
// lúc bấm Cài với "expected a /tree/<branch>/<folder> link".
function bundleUrlProblem(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return 'not a URL'
  }
  if (url.protocol !== 'https:') return 'catalog entries must be https'
  const parsed = tryParseGithubUrl(raw)
  return parsed.ok ? null : parsed.reason
}

// Danh mục do người khác xuất bản: entry biến mất mà không dấu vết là không tra
// được. Một chỗ ghi log duy nhất cho cả đường mạng lẫn đường cache.
function logDroppedUrl(from: string, id: string, url: string, reason: string): void {
  log.warn('templates: catalog entry dropped — url is not installable', {
    from,
    entry: id,
    url,
    reason,
  })
}

// `homepage` là trang chủ người xuất bản tự khai, và UI biến nó thành MỘT CÚ BẤM
// mở trình duyệt hệ thống. Nó không cài gì nên không đi qua `bundleUrlProblem`
// (luật đó ghim github.com + dạng `/tree/`), nhưng vẫn là L1 y hệt: một
// `javascript:`/`data:`/`file:` lọt tới UI là cái bẫy nằm chờ được bấm.
//
// Ở đây cũng chỉ viết đúng MỘT luật của riêng danh mục — "https", cùng điều kiện
// `bundleUrlProblem` áp cho `url`. Phần còn lại (scheme thực thi được, loopback,
// IP nội bộ) hỏi thẳng `ssrfCheck` — đúng hàm mọi lối ra mạng của sidecar đang
// dùng — thay vì chép luật ra chỗ thứ hai.
function homepageProblem(url: string): string | null {
  const guard = ssrfCheck(url)
  // `reason` là optional trên `SsrfGuardResult` — không có thì vẫn phải loại.
  if (!guard.ok) return guard.reason ?? 'not a safe link'
  // `ssrfCheck` còn nhận http; danh mục AWOG tự tuyển thì không có cớ nào để một
  // trang chủ rơi xuống http. `new URL` không thể ném ở đây: `ssrfCheck` vừa parse.
  return new URL(url).protocol === 'https:' ? null : 'homepage must be https'
}

// Homepage hỏng KHÔNG giết entry — nó là siêu dữ liệu phụ, không phải thứ đem
// cài. Chỉ RỤNG RIÊNG cái field, entry vẫn hiện ra bình thường (nhưng có log:
// người xuất bản khai sai thì phải tra được).
function safeHomepage(from: string, id: string, raw?: string): string | undefined {
  if (!raw) return undefined
  const url = raw.trim()
  const problem = homepageProblem(url)
  if (!problem) return url
  log.warn('templates: catalog entry homepage dropped — not a safe link', {
    from,
    entry: id,
    homepage: raw,
    reason: problem,
  })
  return undefined
}

function toEntry(raw: unknown): MarketplaceEntry | null {
  const parsed = EntrySchema.safeParse(raw)
  if (!parsed.success) return null
  const e = parsed.data
  const homepage = safeHomepage('catalog', e.id, e.homepage)
  return {
    id: e.id,
    name: e.name,
    description: e.description ?? '',
    author: e.author ?? '',
    version: e.version ?? '',
    url: e.url,
    kinds: e.kinds ?? [],
    tags: e.tags ?? [],
    ...(homepage ? { homepage } : {}),
  }
}

// Pure — điểm vào của test. Entry hỏng bị bỏ, không giết cả danh mục; id trùng
// giữ bản ĐẦU (danh mục là file người viết tay, trùng id là lỗi soạn thảo).
export function parseCatalog(raw: unknown): MarketplaceEntry[] {
  const doc = CatalogSchema.safeParse(raw)
  if (!doc.success) throw new Error('catalog shape not recognised')
  const out: MarketplaceEntry[] = []
  const seenIds = new Set<string>()
  for (const item of doc.data.templates) {
    const entry = toEntry(item)
    if (!entry) continue
    const problem = bundleUrlProblem(entry.url)
    if (problem) {
      logDroppedUrl('catalog', entry.id, entry.url, problem)
      continue
    }
    if (seenIds.has(entry.id)) continue
    seenIds.add(entry.id)
    out.push(entry)
    if (out.length >= MAX_ENTRIES) break
  }
  return out
}

// Lọc cục bộ — danh mục là MỘT file nhỏ nên không có tìm kiếm phía máy chủ; lọc
// ở đây chạy được cả khi offline (trên cache).
export function filterEntries(entries: MarketplaceEntry[], query: string): MarketplaceEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return entries
  return entries.filter(
    (e) =>
      e.name.toLowerCase().includes(needle) ||
      e.id.toLowerCase().includes(needle) ||
      e.description.toLowerCase().includes(needle) ||
      e.author.toLowerCase().includes(needle) ||
      e.tags.some((tag) => tag.toLowerCase().includes(needle)),
  )
}

// ─── Cache trên đĩa ─────────────────────────────────────────────────────────

function cachePath(): string {
  return join(awogHome(), CACHE_FILE)
}

async function readCache(): Promise<{ fetchedAt: number; entries: MarketplaceEntry[] } | null> {
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
    log.warn('templates: catalog cache invalid, ignoring')
    return null
  }
  // Cache cũ có thể được ghi bởi bản app trước khi siết luật URL — kiểm lại bằng
  // ĐÚNG luật đang chạy, nếu không entry `/blob/…` ghi từ bản trước vẫn hiện ra.
  const entries = parsed.data.entries
    .filter((e) => {
      const problem = bundleUrlProblem(e.url)
      if (problem) logDroppedUrl('cache', e.id, e.url, problem)
      return problem === null
    })
    .map<MarketplaceEntry>((e) => {
      // Cache cũ cũng mang homepage ghi bởi bản app trước khi siết — kiểm lại.
      const homepage = safeHomepage('cache', e.id, e.homepage)
      return {
        id: e.id,
        name: e.name,
        description: e.description,
        author: e.author,
        version: e.version,
        url: e.url,
        kinds: e.kinds,
        tags: e.tags,
        ...(homepage ? { homepage } : {}),
      }
    })
  return { fetchedAt: parsed.data.fetchedAt, entries }
}

async function writeCache(entries: MarketplaceEntry[], fetchedAt: number): Promise<void> {
  const target = cachePath()
  const tmp = `${target}.tmp`
  try {
    await mkdir(awogHome(), { recursive: true, mode: 0o700 })
    await writeFile(tmp, JSON.stringify({ version: CACHE_VERSION, fetchedAt, entries }), 'utf8')
    await chmod(tmp, 0o600)
    await rename(tmp, target)
  } catch (err) {
    log.warn('templates: cannot write catalog cache', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

// ─── Bộ nhớ phiên ───────────────────────────────────────────────────────────

// Entry đã đi qua RPC trong phiên này. `inspect`/`install` tra ở đây trước, nên
// entry người dùng bấm vào là ĐÚNG cái họ vừa xem.
const seen = new Map<string, MarketplaceEntry>()

function remember(entries: MarketplaceEntry[]): void {
  for (const e of entries) seen.set(e.id, e)
}

// ─── API công khai: duyệt ───────────────────────────────────────────────────

// Mạng → cache (kèm banner "đang xem bản cũ") → rỗng có giải thích. KHÔNG BAO
// GIỜ throw: lỗi đi kèm kết quả để UI nói cho người dùng biết đang xem dữ liệu nào.
export async function loadMarketplace(
  opts: { query?: string; refresh?: boolean } = {},
): Promise<MarketplaceResult> {
  const query = opts.query ?? ''
  const cached = await readCache()
  const fresh = cached !== null && Date.now() - cached.fetchedAt < CACHE_TTL_MS
  if (cached && fresh && !opts.refresh) {
    remember(cached.entries)
    return {
      entries: filterEntries(cached.entries, query),
      origin: 'cache',
      fetchedAt: cached.fetchedAt,
      stale: false,
    }
  }
  try {
    const entries = parseCatalog(await getCatalogDoc())
    const fetchedAt = Date.now()
    await writeCache(entries, fetchedAt)
    remember(entries)
    return { entries: filterEntries(entries, query), origin: 'network', fetchedAt, stale: false }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn('templates: catalog fetch failed, falling back', { err: message })
    if (cached) {
      remember(cached.entries)
      return {
        entries: filterEntries(cached.entries, query),
        origin: 'cache',
        fetchedAt: cached.fetchedAt,
        stale: true,
        error: message,
      }
    }
    return { entries: [], origin: 'offline', fetchedAt: null, stale: true, error: message }
  }
}

async function resolveEntry(id: string): Promise<MarketplaceEntry> {
  const hit = seen.get(id)
  if (hit) return hit
  const cached = await readCache()
  const fromCache = cached?.entries.find((e) => e.id === id)
  if (fromCache) {
    seen.set(id, fromCache)
    return fromCache
  }
  const res = await loadMarketplace()
  const fresh = res.entries.find((e) => e.id === id)
  if (!fresh) throw new RpcError(-32602, `Template not in the catalog: ${id}`)
  return fresh
}

// ─── API công khai: kiểm tra trước khi đồng ý ───────────────────────────────

// Băm kế hoạch: entity + từng file (path, blob sha, size). Bất kỳ thay đổi nào ở
// nguồn — thêm một hook, đổi nội dung một file — đều làm token lệch.
//
// Pure để test được mà không cần mạng.
export function planToken(bundle: PlannedBundle, sourceUrl: string): string {
  const lines = [
    `url\t${sourceUrl}`,
    ...bundle.entities
      .map((e) => `entity\t${entityKeyOf(e.kind, e.id)}\t${e.file}`)
      .sort((a, b) => a.localeCompare(b)),
    ...bundle.files
      .map((f) => `file\t${f.repoPath}\t${f.sha}\t${f.size}`)
      .sort((a, b) => a.localeCompare(b)),
  ]
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

// Loại entity bundle chứa mà listing không khai. Pure.
export function undisclosedKinds(
  advertised: ConfigKind[],
  entities: TemplateEntityRef[],
): ConfigKind[] {
  const shown = new Set(advertised)
  const actual = new Set(entities.map((e) => e.kind))
  return KINDS.filter((k) => actual.has(k) && !shown.has(k))
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

async function inspect(
  entry: MarketplaceEntry,
): Promise<{ inspection: MarketplaceInspection; ref: RepoRef; bundle: PlannedBundle }> {
  // `planSingleBundle` parse lại URL (chỉ github.com), đọc tree + template.json,
  // và áp cap kích thước — nhưng KHÔNG ghi gì.
  const { ref, bundle } = await planSingleBundle(entry.url)
  const sourceUrl = bundleUrl(ref, bundle.bundleDir)
  const inspection: MarketplaceInspection = {
    entryId: entry.id,
    templateId: bundle.localId,
    name: bundle.name,
    description: bundle.description,
    ...(bundle.version ? { version: bundle.version } : {}),
    sourceUrl,
    sourceRef: ref.ref,
    entities: bundle.entities,
    fileCount: bundle.files.length,
    totalBytes: bundle.files.reduce((sum, f) => sum + f.size, 0),
    undisclosedKinds: undisclosedKinds(entry.kinds, bundle.entities),
    alreadyInstalled: await dirExists(templateDir(bundle.localId)),
    token: planToken(bundle, sourceUrl),
  }
  return { inspection, ref, bundle }
}

// Đọc nội dung THẬT của bundle để dựng màn hình đồng ý. Không ghi gì cả.
export async function inspectEntry(id: string): Promise<MarketplaceInspection> {
  const entry = await resolveEntry(id)
  const { inspection } = await inspect(entry)
  return inspection
}

// ─── API công khai: cài ─────────────────────────────────────────────────────

// Dựng bundle trong thư mục tạm rồi mới đổi chỗ (giống `remote.ts`/`update.ts`):
// mất mạng giữa chừng thì bản đang có còn nguyên.
async function writePlannedBundle(ref: RepoRef, bundle: PlannedBundle): Promise<void> {
  const staging = stagingDir(bundle.localId)
  await mkdir(staging, { recursive: true, mode: 0o700 })
  try {
    await downloadFilesInto(ref, bundle.files, staging)
    const template: ProjectTemplate & { version?: string } = {
      id: bundle.localId,
      name: bundle.name,
      description: bundle.description,
      createdAt: new Date().toISOString(),
      ...(bundle.version ? { version: bundle.version } : {}),
      entities: bundle.entities,
    }
    await finalizeBundleDir(staging, template, {
      sourceUrl: bundleUrl(ref, bundle.bundleDir),
      sourceRef: ref.ref,
      ...(bundle.version ? { version: bundle.version } : {}),
      // Cài mới: đĩa CHÍNH LÀ nội dung nguồn vừa tải, chưa có sửa đổi cục bộ nào.
      entities: await baselineFromDisk(staging, bundle.entities),
    })
    await swapBundle(staging, bundle.localId)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

// Cài một entry đã được người dùng đồng ý.
//
// `token` là bằng chứng người dùng đã ĐỌC đúng nội dung này: nó băm kế hoạch mà
// `inspectEntry` vừa trả. Lập lại kế hoạch ở đây rồi so token — lệch thì KHÔNG
// GHI GÌ và trả bản kiểm tra mới. Nhờ vậy nguồn không thể tráo nội dung trong lúc
// người dùng đang đọc màn hình đồng ý, và một client gọi thẳng RPC cũng không thể
// bỏ qua bước đồng ý (không có token thì không có đường ghi).
export async function installEntry(
  id: string,
  token: string,
  overwrite: boolean,
): Promise<MarketplaceInstallResult> {
  const entry = await resolveEntry(id)
  const { inspection, ref, bundle } = await inspect(entry)
  if (inspection.token !== token) return { status: 'changed', inspection }
  if (inspection.alreadyInstalled && !overwrite) {
    return { status: 'exists', templateId: inspection.templateId }
  }

  await writePlannedBundle(ref, bundle)
  const template = await getTemplate(bundle.localId)
  if (!template) throw new RpcError(-32012, `Install finished but ${bundle.localId} is unreadable`)
  log.info('templates: installed from catalog', {
    entry: entry.id,
    template: template.id,
    entities: template.entities.length,
  })
  return { status: 'installed', template }
}
