// Rollup cache token usage theo NGÀY (local) cho trang Activity (ADR 0054).
//
// Lưu trữ: ~/.awog/usage/daily/<YYYY-MM-DD>.json — mỗi local-day một file. Nội
// dung là map bucket key → 4 token bucket + turns:
//   key = "<accountId>|<provider>|<model>|<source>|<projectId>"
//   (source = session | task; projectId = '' khi không thuộc dự án nào)
//
// Guardrail bất biến (BẮT BUỘC):
//   - Ngày < hôm nay là BẤT BIẾN → tính một lần, ghi cache (frozen:true), lần
//     sau đọc thẳng cache (KHÔNG quét lại JSONL).
//   - "Hôm nay" KHÔNG bao giờ freeze → luôn tính lại từ log (turn mới vẫn vào).
//
// Quét bounded: nguồn (sessions/store + tasks/store) đọc JSONL tail-first / stop
// khi vượt cửa sổ, và bỏ qua session ngoài range theo updatedAt trước khi chạm
// file. Range 'all' đặt trần MAX_LOOKBACK_DAYS; phần cũ hơn bị bỏ được log rõ
// (no silent cap — memory).

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { collectSessionTurnsSince } from '../sessions/store.js'
import { collectTaskRunsSince } from '../tasks/store.js'

// Một bucket token (cộng dồn nhiều turn cùng key trong ngày).
export interface UsageBucket {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  turns: number
}

export type UsageSource = 'session' | 'task'

// Version của schema cache. Tăng khi format bucket key đổi để cache cũ (key
// thiếu thành phần mới) bị bỏ + tính lại thay vì parse sai.
//   v1 → key = account|provider|model|source
//   v2 → key = account|provider|model|source|projectId  (thêm filter dự án)
const ROLLUP_VERSION = 2

// File rollup một ngày trên đĩa.
interface DailyRollupFile {
  version: typeof ROLLUP_VERSION
  date: string // YYYY-MM-DD (local)
  computedAt: string // ISO
  // true ⇒ ngày đã đóng băng (quá khứ) → đọc cache, không tính lại.
  frozen: boolean
  buckets: Record<string, UsageBucket>
}

// Trần lookback cho range 'all'. Một năm là đủ rộng cho local-first; phần cũ hơn
// bị bỏ + log để không "silent cap".
const MAX_LOOKBACK_DAYS = 365

const USAGE_DIR_NAME = sanitizeChild('usage')
const DAILY_DIR_NAME = sanitizeChild('daily')

function dailyDir(): string {
  return join(awogHome(), USAGE_DIR_NAME, DAILY_DIR_NAME)
}

// File cache cho một ngày. `date` đã được validate (YYYY-MM-DD) ở callsite, vẫn
// sanitize phòng thủ (sanitizeChild chặn '/', '\\', '..').
function dailyFile(date: string): string {
  return join(dailyDir(), `${sanitizeChild(date)}.json`)
}

async function ensureDailyDir(): Promise<void> {
  await mkdir(dailyDir(), { recursive: true, mode: 0o700 })
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

// ─── Local-day helpers ───────────────────────────────────────────────────────
// new Date() chạy theo timezone máy (OK cho sidecar). Day key = local YYYY-MM-DD.

// Exported: every Activity surface that buckets by day MUST use this one, or a
// per-session split stops summing to the daily rollup at midnight boundaries.
export function localDayKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// [start, end) ms của một local-day key.
function dayBounds(dateKey: string): { startMs: number; endMs: number } {
  const [y, m, d] = dateKey.split('-').map((s) => Number.parseInt(s, 10))
  const start = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0)
  const startMs = start.getTime()
  const end = new Date(startMs)
  end.setDate(end.getDate() + 1)
  return { startMs, endMs: end.getTime() }
}

// Day key của hôm nay (local).
function todayKey(): string {
  return localDayKey(Date.now())
}

// Liệt kê day key trong [fromMs, toMs] (local), oldest → newest.
function dayKeysInRange(fromMs: number, toMs: number): string[] {
  const keys: string[] = []
  const cursor = new Date(fromMs)
  cursor.setHours(0, 0, 0, 0)
  const end = new Date(toMs)
  end.setHours(0, 0, 0, 0)
  while (cursor.getTime() <= end.getTime()) {
    keys.push(localDayKey(cursor.getTime()))
    cursor.setDate(cursor.getDate() + 1)
  }
  return keys
}

// ─── Bucket key ────────────────────────────────────────────────────────────

export function bucketKey(
  accountId: string,
  provider: string,
  model: string,
  source: UsageSource,
  projectId: string,
): string {
  return `${accountId}|${provider}|${model}|${source}|${projectId}`
}

// Giải mã bucket key → 5 thành phần. '|' không xuất hiện trong id/provider/
// source/projectId AWOG, nên split an toàn; phần thừa (nếu model có '|') gộp lại
// vào model. source + projectId là 2 token cuối (không chứa '|').
export function parseBucketKey(key: string): {
  accountId: string
  provider: string
  model: string
  source: UsageSource
  projectId: string
} {
  const parts = key.split('|')
  const accountId = parts[0] ?? ''
  const provider = parts[1] ?? ''
  const projectId = parts[parts.length - 1] ?? ''
  const source = (parts[parts.length - 2] ?? 'session') as UsageSource
  const model = parts.slice(2, parts.length - 2).join('|')
  return { accountId, provider, model, source, projectId }
}

function addInto(target: Record<string, UsageBucket>, key: string, add: UsageBucket): void {
  const cur = target[key]
  if (cur) {
    cur.inputTokens += add.inputTokens
    cur.outputTokens += add.outputTokens
    cur.cacheReadTokens += add.cacheReadTokens
    cur.cacheWriteTokens += add.cacheWriteTokens
    cur.turns += add.turns
  } else {
    target[key] = { ...add }
  }
}

// ─── Parse-safe đọc cache ─────────────────────────────────────────────────────

function isUsageBucket(v: unknown): v is UsageBucket {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.inputTokens === 'number' &&
    typeof o.outputTokens === 'number' &&
    typeof o.cacheReadTokens === 'number' &&
    typeof o.cacheWriteTokens === 'number' &&
    typeof o.turns === 'number'
  )
}

// Đọc file rollup một ngày. null = thiếu / hỏng (caller recompute).
async function readDaily(date: string): Promise<DailyRollupFile | null> {
  let raw: string
  try {
    raw = await readFile(dailyFile(date), 'utf8')
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const f = parsed as Record<string, unknown>
    if (f.version !== ROLLUP_VERSION || typeof f.date !== 'string' || typeof f.frozen !== 'boolean')
      return null
    if (!f.buckets || typeof f.buckets !== 'object') return null
    const buckets: Record<string, UsageBucket> = {}
    for (const [k, v] of Object.entries(f.buckets as Record<string, unknown>)) {
      if (isUsageBucket(v)) buckets[k] = v
    }
    return {
      version: ROLLUP_VERSION,
      date: f.date,
      computedAt: typeof f.computedAt === 'string' ? f.computedAt : new Date().toISOString(),
      frozen: f.frozen,
      buckets,
    }
  } catch (err) {
    log.warn('usage rollup: corrupt daily cache, recomputing', {
      date,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// Ghi atomic (tmp + rename) một ngày.
async function writeDaily(file: DailyRollupFile): Promise<void> {
  await ensureDailyDir()
  const target = dailyFile(file.date)
  const tmp = `${target}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(file), { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, target)
}

// ─── Compute một ngày từ JSONL nguồn (session + task) ─────────────────────────

async function computeDay(dateKey: string): Promise<Record<string, UsageBucket>> {
  const { startMs, endMs } = dayBounds(dateKey)
  // endMs là đầu ngày kế tiếp (exclusive) → trừ 1ms cho biên đóng [start, end].
  const windowEndMs = endMs - 1
  const buckets: Record<string, UsageBucket> = {}

  const turns = await collectSessionTurnsSince(startMs, windowEndMs)
  for (const t of turns) {
    addInto(buckets, bucketKey(t.accountId, t.provider, t.model, 'session', t.projectId), {
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      cacheReadTokens: t.cacheReadTokens,
      cacheWriteTokens: t.cacheWriteTokens,
      turns: 1,
    })
  }

  const runs = await collectTaskRunsSince(startMs, windowEndMs)
  for (const r of runs) {
    addInto(buckets, bucketKey(r.accountId, r.provider, r.model, 'task', r.projectId), {
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheWriteTokens: r.cacheWriteTokens,
      turns: 1,
    })
  }

  return buckets
}

// ─── Public: lấy buckets cho một ngày (đọc cache / tính + freeze) ─────────────

// Trả về buckets của một local-day. Ngày quá khứ: đọc frozen cache nếu có, nếu
// chưa thì tính một lần rồi ghi frozen. Hôm nay: luôn tính lại (không freeze,
// không đọc cache cũ — turn mới phải vào).
async function bucketsForDay(dateKey: string, isToday: boolean): Promise<Record<string, UsageBucket>> {
  if (!isToday) {
    const cached = await readDaily(dateKey)
    if (cached && cached.frozen) return cached.buckets
    // Chưa cache / cache không frozen (vd file viết dở của hôm trước) → tính +
    // freeze (ngày đã qua nên bất biến).
    const buckets = await computeDay(dateKey)
    try {
      await writeDaily({
        version: ROLLUP_VERSION,
        date: dateKey,
        computedAt: new Date().toISOString(),
        frozen: true,
        buckets,
      })
    } catch (err) {
      log.warn('usage rollup: failed to write frozen daily cache', {
        date: dateKey,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    return buckets
  }
  // Hôm nay: tính tươi. KHÔNG ghi frozen (sẽ recompute lần sau).
  return computeDay(dateKey)
}

// Một ngày trong range với buckets đã resolve.
export interface DayRollup {
  date: string
  buckets: Record<string, UsageBucket>
}

// Gom rollup cho mọi local-day trong [fromMs, toMs]. Trả oldest → newest. Bao
// cả ngày rỗng (buckets = {}) để timeseries liền mạch.
export async function rollupRange(fromMs: number, toMs: number): Promise<DayRollup[]> {
  const today = todayKey()
  const keys = dayKeysInRange(fromMs, toMs)
  const out: DayRollup[] = []
  for (const dateKey of keys) {
    // eslint-disable-next-line no-await-in-loop
    const buckets = await bucketsForDay(dateKey, dateKey === today)
    out.push({ date: dateKey, buckets })
  }
  return out
}

// ─── Range → [fromMs, toMs] ───────────────────────────────────────────────────

export type RollupRangeId = '1d' | '7d' | '30d' | '90d' | 'all'

// Số ngày lookback (kể cả hôm nay) cho mỗi range. 'all' dùng trần
// MAX_LOOKBACK_DAYS để không quét vô hạn; phần cũ hơn bị bỏ + log.
export function rangeToWindow(range: RollupRangeId): { fromMs: number; toMs: number; capped: boolean } {
  const toMs = Date.now()
  const start = new Date(toMs)
  start.setHours(0, 0, 0, 0)
  let days: number
  let capped = false
  switch (range) {
    case '1d':
      days = 1
      break
    case '7d':
      days = 7
      break
    case '30d':
      days = 30
      break
    case '90d':
      days = 90
      break
    case 'all':
      days = MAX_LOOKBACK_DAYS
      capped = true
      break
    default:
      days = 7
  }
  // days bao gồm hôm nay → lùi (days - 1) ngày.
  start.setDate(start.getDate() - (days - 1))
  if (range === 'all') {
    log.info('usage rollup: range=all capped to lookback window', {
      maxLookbackDays: MAX_LOOKBACK_DAYS,
      note: 'usage older than the window is omitted from Activity',
    })
  }
  return { fromMs: start.getTime(), toMs, capped }
}
