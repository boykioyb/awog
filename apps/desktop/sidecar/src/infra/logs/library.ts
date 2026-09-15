// Thư viện query Insights — Mốc 2 việc 2.4 ("mẫu sẵn · đã lưu · lịch sử").
//
// VÌ SAO KHÔNG CHỈ LÀ MỘT MẢNG TRONG `localStorage`. Một câu Insights tốt là tài
// sản: nó mã hoá cấu trúc log của một hệ thống, và nó có SỐ ĐO đi kèm
// (`bytesScanned` của lần chạy trước) — thứ biến ước lượng GB ở 2.6 từ phỏng đoán
// thành số thật. Cả hai đều thuộc về cấp THIẾT BỊ, không phải một profile trình
// duyệt, và phải đọc được từ tiến trình sidecar (nơi ước lượng chạy).
//
// LUẬT ĐĨA, giống `audit/store.ts` và `account-ids.ts`: thư mục `~/.awog` 0700,
// file 0600, ghi NGUYÊN TỬ qua file tạm cùng thư mục rồi `rename`. File hỏng thì
// coi như RỖNG và tự ghi lại ở lần lưu sau — không bao giờ ném ra UI chỉ vì một
// file phụ trợ hỏng.
//
// LUẬT NỘI DUNG. Ở đây chỉ có câu QUERY và tên log group. Không có giá trị
// credential nào đi qua file này, và không dòng log nào được lưu lại — thư viện
// nhớ *cách hỏi*, không nhớ *câu trả lời*.
//
// BỀ MẶT CỦA CON NGƯỜI. Không AgentTool nào gọi module này: agent không được tự
// ghi vào thư viện của người dùng (nó có thể ĐỌC mẫu để gợi ý, nhưng đường ghi
// là của người dùng bấm Lưu).

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { log } from '../../util/logger.js'
import { awogHome, sanitizeChild } from '../../util/path.js'

// ─── Trần ───────────────────────────────────────────────────────────────────

/** Trần số câu ĐÃ LƯU. Vượt trần ⇒ từ chối kèm mã `TOO_MANY_SAVED`, không cắt im lặng. */
export const MAX_SAVED = 200
/** Trần lịch sử. Lịch sử là vòng quay: cũ nhất bị đẩy ra, không phải lỗi. */
export const MAX_HISTORY = 100
const MAX_NAME_CHARS = 120
const MAX_QUERY_CHARS = 4096

const DIR = sanitizeChild('infra')
const SUBDIR = sanitizeChild('logs')
const FILE = sanitizeChild('queries.json')

// ─── Kiểu công khai ─────────────────────────────────────────────────────────

/** Một mẫu dựng sẵn. `id` ổn định để UI nhớ "mẫu đã dùng" và để i18n dịch tiêu đề. */
export type LogQueryTemplate = {
  id: LogQueryTemplateId
  /** Câu Insights. KHÔNG dịch: cú pháp là của AWS, không phải của người dùng. */
  query: string
  /** Khoảng thời gian gợi ý (giây) — mẫu "lỗi 500" hợp với 1 giờ hơn 30 ngày. */
  windowSeconds: number
}

export const LOG_QUERY_TEMPLATE_IDS = [
  'errors',
  'slow',
  'status5xx',
  'topMessages',
  'latencyP99',
  'lambdaTimeouts',
  'coldStarts',
  'volumeByHour',
] as const

export type LogQueryTemplateId = (typeof LOG_QUERY_TEMPLATE_IDS)[number]

/**
 * Mẫu sẵn. Cố ý dùng cột `@message` (cột mặc định của CloudWatch) và các tên
 * trường phổ biến của log JSON (`status`, `duration`, `level`) — mẫu phải chạy
 * được trên log CHƯA biết cấu trúc mới có ích.
 */
export const LOG_QUERY_TEMPLATES: readonly LogQueryTemplate[] = [
  {
    id: 'errors',
    query: 'fields @timestamp, @message | filter @message like /(?i)(error|exception|fail)/ | sort @timestamp desc | limit 100',
    windowSeconds: 3600,
  },
  {
    id: 'slow',
    query: 'fields @timestamp, @message, duration | filter duration > 1000 | sort duration desc | limit 100',
    windowSeconds: 3600,
  },
  {
    id: 'status5xx',
    query: "fields @timestamp, @message, status | filter status >= 500 | sort @timestamp desc | limit 100",
    windowSeconds: 3600,
  },
  {
    id: 'topMessages',
    query: 'fields @message | stats count(*) as n by @message | sort n desc | limit 50',
    windowSeconds: 86400,
  },
  {
    id: 'latencyP99',
    query: 'fields duration | stats pct(duration, 99) as p99, avg(duration) as avg, count(*) as n by bin(5m)',
    windowSeconds: 21600,
  },
  {
    id: 'lambdaTimeouts',
    query: 'fields @timestamp, @message | filter @message like /Task timed out/ | sort @timestamp desc | limit 100',
    windowSeconds: 86400,
  },
  {
    id: 'coldStarts',
    query: 'fields @timestamp, @message | filter @message like /Init Duration/ | sort @timestamp desc | limit 100',
    windowSeconds: 86400,
  },
  {
    id: 'volumeByHour',
    query: 'stats count(*) as n by bin(1h)',
    windowSeconds: 604800,
  },
] as const

export type SavedQuery = {
  id: string
  name: string
  query: string
  logGroups: string[]
  windowSeconds: number
  /** ISO 8601. */
  savedAt: string
  /** `bytesScanned` của lần chạy gần nhất ⇒ cơ sở ước lượng GB lần sau. */
  lastBytesScanned?: number
}

export type HistoryEntry = {
  id: string
  query: string
  logGroups: string[]
  windowSeconds: number
  /** ISO 8601. */
  ranAt: string
  bytesScanned: number
  /** USD đã ước lượng trước khi chạy — để đối chiếu ước lượng với số đo. */
  estimatedUsd?: number
  recordsMatched: number
  /** `Complete` · `Cancelled` · `Failed`… */
  status: string
}

export type QueryLibrary = { saved: SavedQuery[]; history: HistoryEntry[] }

// ─── Lược đồ đĩa ────────────────────────────────────────────────────────────

const LogGroupNameList = z.array(z.string().min(1).max(512)).max(25)

const SavedSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(MAX_NAME_CHARS),
  query: z.string().min(1).max(MAX_QUERY_CHARS),
  logGroups: LogGroupNameList,
  windowSeconds: z.number().int().positive().max(30 * 24 * 3600),
  savedAt: z.string().max(64),
  lastBytesScanned: z.number().nonnegative().optional(),
})

const HistorySchema = z.object({
  id: z.string().min(1).max(64),
  query: z.string().min(1).max(MAX_QUERY_CHARS),
  logGroups: LogGroupNameList,
  windowSeconds: z.number().int().positive().max(30 * 24 * 3600),
  ranAt: z.string().max(64),
  bytesScanned: z.number().nonnegative(),
  estimatedUsd: z.number().nonnegative().optional(),
  recordsMatched: z.number().nonnegative(),
  status: z.string().max(32),
})

// Cố ý KHÔNG `.strict()`: bản AWOG mới hơn thêm trường thì bản cũ phải bỏ qua,
// không được coi cả file là hỏng (cùng luật với `audit/store.ts`).
const FileSchema = z.object({
  version: z.number().int().optional(),
  saved: z.array(SavedSchema).default([]),
  history: z.array(HistorySchema).default([]),
})

// ─── Đường dẫn ──────────────────────────────────────────────────────────────

export function logsLibraryDir(): string {
  return join(awogHome(), DIR, SUBDIR)
}

export function logsLibraryFile(): string {
  return join(logsLibraryDir(), FILE)
}

// ─── Đọc ────────────────────────────────────────────────────────────────────

/**
 * Đọc thư viện. KHÔNG BAO GIỜ NÉM: file thiếu = thư viện rỗng (lần dùng đầu
 * tiên); file hỏng = thư viện rỗng + một dòng log cảnh báo. Người dùng mất thư
 * viện vì một file JSON hỏng là chuyện nhỏ so với màn Logs không mở được.
 */
export async function readLibrary(): Promise<QueryLibrary> {
  let raw: string
  try {
    raw = await readFile(logsLibraryFile(), 'utf8')
  } catch {
    return { saved: [], history: [] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    log.warn('logs-library: file is not valid JSON, starting empty')
    return { saved: [], history: [] }
  }
  const result = FileSchema.safeParse(parsed)
  if (!result.success) {
    log.warn('logs-library: file does not match the schema, starting empty')
    return { saved: [], history: [] }
  }
  return {
    saved: result.data.saved.map((s) => ({
      id: s.id,
      name: s.name,
      query: s.query,
      logGroups: [...s.logGroups],
      windowSeconds: s.windowSeconds,
      savedAt: s.savedAt,
      ...(s.lastBytesScanned !== undefined ? { lastBytesScanned: s.lastBytesScanned } : {}),
    })),
    history: result.data.history.map((h) => ({
      id: h.id,
      query: h.query,
      logGroups: [...h.logGroups],
      windowSeconds: h.windowSeconds,
      ranAt: h.ranAt,
      bytesScanned: h.bytesScanned,
      ...(h.estimatedUsd !== undefined ? { estimatedUsd: h.estimatedUsd } : {}),
      recordsMatched: h.recordsMatched,
      status: h.status,
    })),
  }
}

async function writeLibrary(library: QueryLibrary): Promise<void> {
  const dir = logsLibraryDir()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  // chmod lại mỗi lần ghi: quyền tự lành nếu ai đó nới ra bằng tay.
  await chmod(join(awogHome(), DIR), 0o700)
  await chmod(dir, 0o700)

  const file = logsLibraryFile()
  const tmp = `${file}.tmp.${process.pid}`
  const body = { version: 1, saved: library.saved, history: library.history }
  await writeFile(tmp, JSON.stringify(body, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

// ─── Ghi: đã lưu ────────────────────────────────────────────────────────────

export type SaveQueryInput = {
  name: string
  query: string
  logGroups: readonly string[]
  windowSeconds: number
  /** Có ⇒ ghi ĐÈ câu cùng tên thay vì tạo bản thứ hai trùng tên. */
  id?: string | undefined
}

export async function saveQuery(input: SaveQueryInput): Promise<SavedQuery> {
  const name = input.name.trim()
  if (name.length === 0 || name.length > MAX_NAME_CHARS) throw new Error('INVALID_NAME: tên không hợp lệ.')
  const query = input.query.trim()
  if (query.length === 0 || query.length > MAX_QUERY_CHARS) {
    throw new Error('INVALID_QUERY: câu lệnh rỗng hoặc quá dài.')
  }

  const library = await readLibrary()
  const existingIndex = input.id
    ? library.saved.findIndex((s) => s.id === input.id)
    : library.saved.findIndex((s) => s.name === name)

  if (existingIndex === -1 && library.saved.length >= MAX_SAVED) {
    throw new Error(`TOO_MANY_SAVED: thư viện đã có ${String(MAX_SAVED)} câu — xoá bớt rồi lưu tiếp.`)
  }

  const entry: SavedQuery = {
    id: existingIndex >= 0 ? library.saved[existingIndex]!.id : newId(),
    name,
    query,
    logGroups: [...input.logGroups],
    windowSeconds: input.windowSeconds,
    savedAt: new Date().toISOString(),
    ...(existingIndex >= 0 && library.saved[existingIndex]!.lastBytesScanned !== undefined
      ? { lastBytesScanned: library.saved[existingIndex]!.lastBytesScanned }
      : {}),
  }

  if (existingIndex >= 0) library.saved[existingIndex] = entry
  else library.saved.unshift(entry)

  await writeLibrary(library)
  return entry
}

export async function deleteSavedQuery(id: string): Promise<{ removed: boolean }> {
  const library = await readLibrary()
  const next = library.saved.filter((s) => s.id !== id)
  if (next.length === library.saved.length) return { removed: false }
  library.saved = next
  await writeLibrary(library)
  return { removed: true }
}

// ─── Ghi: lịch sử ───────────────────────────────────────────────────────────

export type RecordRunInput = {
  query: string
  logGroups: readonly string[]
  windowSeconds: number
  bytesScanned: number
  estimatedUsd?: number | undefined
  recordsMatched: number
  status: string
}

/**
 * Ghi một lần chạy vào lịch sử, và ĐỒNG THỜI cập nhật `lastBytesScanned` của câu
 * đã lưu khớp câu lệnh — đó là cơ chế biến ước lượng GB ở lần sau thành số đo.
 *
 * Cố ý KHÔNG NÉM khi ghi hỏng: đây là ghi công khai (audit) chứ không phải bằng
 * chứng; mất một dòng lịch sử không được phép làm hỏng kết quả truy vấn vừa chạy
 * xong của người dùng.
 */
export async function recordRun(input: RecordRunInput): Promise<void> {
  try {
    const library = await readLibrary()
    const entry: HistoryEntry = {
      id: newId(),
      query: input.query,
      logGroups: [...input.logGroups],
      windowSeconds: input.windowSeconds,
      ranAt: new Date().toISOString(),
      bytesScanned: input.bytesScanned,
      ...(input.estimatedUsd !== undefined ? { estimatedUsd: input.estimatedUsd } : {}),
      recordsMatched: input.recordsMatched,
      status: input.status,
    }
    library.history.unshift(entry)
    if (library.history.length > MAX_HISTORY) library.history.length = MAX_HISTORY

    // Chỉ cập nhật số đo cho câu ĐÃ LƯU khi lần chạy THÀNH CÔNG — một lần chạy
    // bị huỷ giữa đường trả `bytesScanned` rất nhỏ, và lấy nó làm cơ sở ước lượng
    // sẽ dạy cho app rằng câu đó rẻ, đúng lúc nó không rẻ.
    if (input.status === 'Complete') {
      for (const saved of library.saved) {
        if (saved.query === input.query) saved.lastBytesScanned = input.bytesScanned
      }
    }

    await writeLibrary(library)
  } catch (err) {
    log.warn('logs-library: failed to record run', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Số đo gần nhất của một câu lệnh, hoặc undefined. Dùng cho ước lượng trước khi chạy. */
export async function lastBytesFor(query: string): Promise<number | undefined> {
  const library = await readLibrary()
  const saved = library.saved.find((s) => s.query === query)
  if (saved?.lastBytesScanned !== undefined) return saved.lastBytesScanned
  const hist = library.history.find((h) => h.query === query && h.status === 'Complete')
  return hist ? hist.bytesScanned : undefined
}

/** Xoá lịch sử. Bề mặt NGƯỜI DÙNG (nút trong thư viện), không phải đường của agent. */
export async function clearHistory(): Promise<{ removed: number }> {
  const library = await readLibrary()
  const removed = library.history.length
  library.history = []
  await writeLibrary(library)
  return { removed }
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
