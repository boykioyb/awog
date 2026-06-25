// Remote pricing layer — giá model lấy từ một nguồn JSON curated công khai
// (LiteLLM) rồi merge vào pricing catalog. Tầng "remote" nằm GIỮA default và
// override: priority hiệu lực = override > remote > default.
//
// Bảo mật (security.md):
//  #5 allowlist host / #7 no-SSRF — URL nguồn HARDCODE cố định (không nhận từ
//     payload UI), chỉ host raw.githubusercontent.com được liên hệ; ssrfCheck()
//     literal-host + DNS-resolve + host allowlist gate mỗi request, và host
//     sau redirect được kiểm tra lại. Không log token/secret (URL công khai,
//     không gửi credential).
//  L1 — payload remote là không tin: JSON parse guarded, cap kích thước, chỉ
//     pick số hữu hạn không âm; model không match giữ nguyên default.
//  #2 Path — file persist ghi cố định trong ~/.awog/usage/ (atomic tmp+rename).

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { lookup } from 'node:dns/promises'
import { awogHome } from '../util/path.js'
import { ssrfCheck, blockedHostReason } from '../mcp/http-client.js'
import { log } from '../util/logger.js'
import { defaultModelKeys } from './catalog.js'
import type { ModelPriceRates, RemotePricingMap } from './catalog.js'

// Nguồn giá curated. URL công khai trên GitHub raw — đã probe trả 200 (biến thể
// `.../litellm/model_prices_and_context_window.json` trả 404 nên KHÔNG dùng).
export const REMOTE_PRICING_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

const ALLOWED_HOST = 'raw.githubusercontent.com'
const FETCH_TIMEOUT_MS = 10_000
const MAX_BYTES = 8 * 1024 * 1024 // 8 MB — file LiteLLM ~1.6 MB, để dư biên an toàn.

const REMOTE_DIR = 'usage'
const REMOTE_FILE = 'pricing-remote.json'

// ─── On-disk shape ───────────────────────────────────────────────────────────

// File persist remote layer. prices = USD/1M token theo AWOG model id.
export interface RemotePricingFile {
  fetchedAt: string
  source: string
  prices: Record<string, ModelPriceRates>
}

function remotePath(): string {
  return join(awogHome(), REMOTE_DIR, REMOTE_FILE)
}

function isFiniteNonNeg(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0
}

// Parse-safe: chỉ pick 4 bucket là số hữu hạn không âm. Thiếu bucket → 0.
function sanitizeRates(value: unknown): ModelPriceRates | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const rates: ModelPriceRates = {
    input: isFiniteNonNeg(v.input) ? v.input : 0,
    output: isFiniteNonNeg(v.output) ? v.output : 0,
    cacheRead: isFiniteNonNeg(v.cacheRead) ? v.cacheRead : 0,
    cacheWrite: isFiniteNonNeg(v.cacheWrite) ? v.cacheWrite : 0,
  }
  return rates
}

// Đọc remote layer từ đĩa. Trả null nếu chưa fetch lần nào hoặc file hỏng
// (fail-safe: caller chỉ fallback về default, không vỡ).
export async function loadRemotePricing(): Promise<RemotePricingFile | null> {
  let raw: string
  try {
    raw = await readFile(remotePath(), 'utf8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    log.warn('pricing: remote layer file is not valid JSON, ignoring')
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  const fetchedAt = typeof obj.fetchedAt === 'string' ? obj.fetchedAt : ''
  const source = typeof obj.source === 'string' ? obj.source : ''
  const rawPrices =
    obj.prices && typeof obj.prices === 'object' && !Array.isArray(obj.prices)
      ? (obj.prices as Record<string, unknown>)
      : {}
  const prices: Record<string, ModelPriceRates> = {}
  for (const [model, value] of Object.entries(rawPrices)) {
    if (!model || typeof model !== 'string') continue
    const rates = sanitizeRates(value)
    if (rates) prices[model] = rates
  }
  if (!fetchedAt) return null
  return { fetchedAt, source, prices }
}

// Map remote prices → effective rates lookup (RemotePricingMap re-export từ
// catalog để một nguồn type duy nhất). Trả map USD/1M token theo model id đã
// làm sạch; dùng bởi getEffectivePricing để merge tầng remote.
export async function loadRemotePricingMap(): Promise<RemotePricingMap> {
  const file = await loadRemotePricing()
  return file?.prices ?? {}
}

// ─── HTTP (allowlisted, capped) ───────────────────────────────────────────────

// SSRF guard cho URL hardcode: literal-host check + DNS-resolve mọi địa chỉ +
// host allowlist (chỉ raw.githubusercontent.com). URL là L3 (hằng số) nên không
// có injection, nhưng vẫn DNS-resolve để phòng record trỏ private IP.
async function assertSourceAllowed(urlStr: string): Promise<URL> {
  const guard = ssrfCheck(urlStr)
  if (!guard.ok) throw new Error(`blocked URL: ${guard.reason}`)
  const url = new URL(urlStr)
  if (url.hostname.toLowerCase() !== ALLOWED_HOST) {
    throw new Error(`host not allowed: ${url.hostname}`)
  }
  let resolved: { address: string }[]
  try {
    resolved = await lookup(url.hostname, { all: true })
  } catch {
    throw new Error(`cannot resolve host ${url.hostname}`)
  }
  for (const { address } of resolved) {
    const reason = blockedHostReason(address)
    if (reason) throw new Error(`blocked URL — ${url.hostname} resolves to ${reason}`)
  }
  return url
}

// LiteLLM entry shape (chỉ field ta cần). Giá là USD per TOKEN.
interface LiteLlmEntry {
  input_cost_per_token?: unknown
  output_cost_per_token?: unknown
  cache_read_input_token_cost?: unknown
  cache_creation_input_token_cost?: unknown
}

function perTokenToPerMillion(value: unknown): number {
  return isFiniteNonNeg(value) ? value * 1e6 : 0
}

// Fetch + parse nguồn JSON curated. Không follow redirect sang host khác
// (redirect: 'manual' → coi redirect là lỗi; raw.githubusercontent.com phục vụ
// 200 trực tiếp cho file text, không 302 sang object store như blob lớn của API).
async function fetchSourceJson(): Promise<Record<string, unknown>> {
  await assertSourceAllowed(REMOTE_PRICING_URL)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(REMOTE_PRICING_URL, {
      method: 'GET',
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'AWOG-pricing-fetch' },
    })
  } catch (err) {
    throw new Error(`network error: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timer)
  }
  // redirect: 'manual' → status 3xx hoặc type 'opaqueredirect' nghĩa là server
  // muốn chuyển host khác → từ chối (không follow sang host ngoài allowlist).
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    throw new Error(`unexpected redirect (HTTP ${res.status}) — refusing to follow`)
  }
  if (!res.ok) throw new Error(`source returned HTTP ${res.status}`)

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(`source too large (${buf.byteLength} > ${MAX_BYTES} bytes)`)
  }
  let json: unknown
  try {
    json = JSON.parse(buf.toString('utf8'))
  } catch {
    throw new Error('source is not valid JSON')
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('source JSON is not an object map')
  }
  return json as Record<string, unknown>
}

// ─── AWOG model id → LiteLLM key ──────────────────────────────────────────────

// Sinh danh sách key LiteLLM ứng viên cho một AWOG model id, theo thứ tự ưu tiên:
//  1) direct match (đa số id AWOG = key LiteLLM canonical, vd `gpt-5.1`,
//     `claude-opus-4-8`, `gemini-2.5-pro`).
//  2) bỏ suffix biến thể `-1m` (1M-context map về model base, vd
//     `claude-opus-4-8-1m` → `claude-opus-4-8`).
// Codex (`gpt-5.1-codex`, `gpt-5-codex`) đã là key LiteLLM riêng → KHÔNG strip
// `-codex` (giá codex khác giá GPT-5.1 chung; direct match đủ).
function litellmKeyCandidates(awogId: string): string[] {
  const out = [awogId]
  if (awogId.endsWith('-1m')) out.push(awogId.slice(0, -'-1m'.length))
  return out
}

// ─── Persist ──────────────────────────────────────────────────────────────────

async function writeRemoteFile(file: RemotePricingFile): Promise<void> {
  const dir = join(awogHome(), REMOTE_DIR)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const dest = remotePath()
  const tmp = `${dest}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(file, null, 2), 'utf8')
  await rename(tmp, dest)
}

// Fetch nguồn curated, map sang AWOG model id, persist remote layer xuống đĩa.
// Trả về file đã ghi (fetchedAt/source/prices) để caller build response. CHỈ
// model match được mới vào prices; model không match giữ default (caller merge).
export async function refreshRemotePricing(): Promise<RemotePricingFile> {
  const source = await fetchSourceJson()
  const prices: Record<string, ModelPriceRates> = {}

  for (const awogId of defaultModelKeys()) {
    let entry: LiteLlmEntry | undefined
    for (const key of litellmKeyCandidates(awogId)) {
      const candidate = source[key]
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        entry = candidate as LiteLlmEntry
        break
      }
    }
    if (!entry) continue // không match → bỏ qua, giữ default.
    // Chỉ ghi khi có ít nhất input hoặc output (tránh entry rỗng/không phải LLM).
    if (!isFiniteNonNeg(entry.input_cost_per_token) && !isFiniteNonNeg(entry.output_cost_per_token)) {
      continue
    }
    prices[awogId] = {
      input: perTokenToPerMillion(entry.input_cost_per_token),
      output: perTokenToPerMillion(entry.output_cost_per_token),
      cacheRead: perTokenToPerMillion(entry.cache_read_input_token_cost),
      // LiteLLM để null cho provider không có bucket cache-write riêng → 0.
      cacheWrite: perTokenToPerMillion(entry.cache_creation_input_token_cost),
    }
  }

  const file: RemotePricingFile = {
    fetchedAt: new Date().toISOString(),
    source: REMOTE_PRICING_URL,
    prices,
  }
  await writeRemoteFile(file)
  log.info('pricing: remote layer refreshed', { matched: Object.keys(prices).length })
  return file
}
