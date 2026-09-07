// Danh sách PR đang được theo dõi + thứ đã báo lần trước.
//
// NHÀ: `~/.awog/pr-watch.json`. Đây là dữ liệu AWOG-only (không phải config dùng
// chung với Claude Code CLI) nên nó ở `.awog`, không phải `.claude` — ADR 0070.
// Một file duy nhất chứ không phải một file mỗi PR: danh sách bị chặn ở
// MAX_WATCHED entry và LUÔN được đọc/ghi trọn vẹn (mỗi nhịp poll cập nhật gần như
// tất cả các dòng), nên tách file chỉ tạo thêm I/O.
//
// Vì sao phải persist "lần trước thấy gì": mốc so sánh chính là thứ biến một cái
// poll thành một SỰ KIỆN. Giữ trong RAM thì mỗi lần khởi động lại app, nhịp poll
// đầu tiên sẽ coi mọi thứ là mới và bắn một loạt tin về CI đã xong từ hôm qua.
//
// File này là dữ liệu L2 (đọc từ đĩa): parse xong PHẢI qua schema trước khi dùng.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { awogHome } from '../util/path.js'
import { log } from '../util/logger.js'
import { MAX_WATCHED, REPO_RE, prKey } from './pr-status.js'

const FILE_NAME = 'pr-watch.json'

const CiStateSchema = z.enum(['pass', 'fail', 'pending', 'none'])

const EntrySchema = z.object({
  repo: z.string().regex(REPO_RE),
  number: z.number().int().positive(),
  // Nhãn hiển thị lần cuối nhìn thấy (tiêu đề PR đổi được).
  title: z.string().default(''),
  url: z.string().default(''),
  // Tài khoản gh dùng để hỏi PR này ('' = tài khoản mặc định/đang active).
  account: z.string().default(''),
  projectId: z.string().nullable().default(null),
  // Phiên (engine id) sẽ nhận tin khi có biến động. null = chỉ hiện trên UI.
  sessionId: z.string().nullable().default(null),
  addedAt: z.string().default(''),
  // Mốc so sánh: dấu vân tay của trạng thái đã báo lần trước. null = chưa từng
  // quan sát ⇒ lần quan sát đầu là NỀN, im lặng.
  lastFingerprint: z.string().nullable().default(null),
  lastUpdatedAt: z.string().nullable().default(null),
  lastCheckedAt: z.string().nullable().default(null),
  // Ảnh chụp gọn cho UI (để mở app lên là có cái để hiện, không phải chờ nhịp poll).
  lastCi: CiStateSchema.default('none'),
  lastReviewDecision: z.string().default(''),
  lastFailingCheck: z.string().nullable().default(null),
  // Review mới nhất đã thấy ("@login|STATE|submittedAt") và trạng thái PR
  // (OPEN/MERGED/CLOSED) — hai thứ này không suy ra được từ dấu vân tay, mà báo
  // cáo cần nói ĐÚNG cái gì đã đổi chứ không phải "có gì đó đổi".
  lastReviewKey: z.string().default(''),
  lastState: z.string().default(''),
})

const FileSchema = z.object({
  version: z.literal(1).default(1),
  entries: z.array(EntrySchema).default([]),
})

export type PrWatchEntry = z.infer<typeof EntrySchema>

function filePath(): string {
  return join(awogHome(), FILE_NAME)
}

// Bộ nhớ tạm của tiến trình. Sidecar là tiến trình duy nhất chạm file này, nên một
// bản trong RAM + ghi tuần tự là đủ; không có khoá liên tiến trình nào cần thiết.
let cache: PrWatchEntry[] | null = null
let writeChain: Promise<void> = Promise.resolve()

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

export async function loadWatchList(): Promise<PrWatchEntry[]> {
  if (cache) return cache
  try {
    const raw = await readFile(filePath(), 'utf8')
    const parsed = FileSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      log.warn('pr-watch: file failed validation, starting empty')
      cache = []
    } else {
      cache = parsed.data.entries.slice(0, MAX_WATCHED)
    }
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('pr-watch: failed to read', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
    cache = []
  }
  return cache
}

// Ghi nguyên file, atomic (tmp + rename) như projects/store.ts. Nối chuỗi promise
// để hai lần ghi chồng nhau không đua nhau trên cùng một file tmp.
async function persist(entries: PrWatchEntry[]): Promise<void> {
  cache = entries
  const body = JSON.stringify({ version: 1, entries }, null, 2)
  writeChain = writeChain.then(async () => {
    const target = filePath()
    const tmp = `${target}.tmp`
    try {
      await mkdir(awogHome(), { recursive: true, mode: 0o700 })
      await writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 })
      await rename(tmp, target)
    } catch (err) {
      log.warn('pr-watch: failed to write', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
  })
  await writeChain
}

export function entryKey(entry: { repo: string; number: number }): string {
  return prKey(entry.repo, entry.number)
}

export interface AddWatchInput {
  repo: string
  number: number
  title?: string | undefined
  url?: string | undefined
  account?: string | undefined
  projectId?: string | null | undefined
  sessionId?: string | null | undefined
}

// Bật theo dõi. Theo dõi lại một PR đã có = cập nhật phần gắn kết (phiên/dự án/
// tài khoản), KHÔNG xoá mốc so sánh — nếu không, đổi phiên nhận sẽ làm lần poll
// kế tiếp báo lại toàn bộ trạng thái cũ như thể vừa xảy ra.
export async function addWatch(input: AddWatchInput): Promise<PrWatchEntry> {
  const entries = [...(await loadWatchList())]
  const key = prKey(input.repo, input.number)
  const existing = entries.find((e) => entryKey(e) === key)
  if (existing) {
    const updated: PrWatchEntry = {
      ...existing,
      title: input.title ?? existing.title,
      url: input.url ?? existing.url,
      account: input.account ?? existing.account,
      projectId: input.projectId !== undefined ? input.projectId : existing.projectId,
      sessionId: input.sessionId !== undefined ? input.sessionId : existing.sessionId,
    }
    await persist(entries.map((e) => (entryKey(e) === key ? updated : e)))
    return updated
  }
  if (entries.length >= MAX_WATCHED) {
    throw new WatchLimitError(
      `Already watching ${entries.length} pull requests (limit ${MAX_WATCHED}). Stop watching one first.`,
    )
  }
  const entry: PrWatchEntry = {
    repo: input.repo,
    number: input.number,
    title: input.title ?? '',
    url: input.url ?? '',
    account: input.account ?? '',
    projectId: input.projectId ?? null,
    sessionId: input.sessionId ?? null,
    addedAt: new Date().toISOString(),
    lastFingerprint: null,
    lastUpdatedAt: null,
    lastCheckedAt: null,
    lastCi: 'none',
    lastReviewDecision: '',
    lastFailingCheck: null,
    lastReviewKey: '',
    lastState: '',
  }
  entries.push(entry)
  await persist(entries)
  return entry
}

export class WatchLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WatchLimitError'
  }
}

export async function removeWatch(repo: string, number: number): Promise<void> {
  const entries = await loadWatchList()
  const key = prKey(repo, number)
  const kept = entries.filter((e) => entryKey(e) !== key)
  if (kept.length !== entries.length) await persist(kept)
}

// Ghi lại kết quả một vòng poll. Nhận nguyên danh sách đã cập nhật để chỉ ghi đĩa
// MỘT lần cho cả vòng.
export async function saveWatchList(entries: PrWatchEntry[]): Promise<void> {
  await persist(entries)
}

// Gỡ liên kết phiên cho các phiên không còn tồn tại (đã xoá/lưu trữ). Entry vẫn
// được theo dõi — chỉ là không còn ai để giao tin.
export async function unbindSessions(sessionIds: ReadonlySet<string>): Promise<void> {
  const entries = await loadWatchList()
  if (!entries.some((e) => e.sessionId !== null && sessionIds.has(e.sessionId))) return
  await persist(
    entries.map((e) => (e.sessionId && sessionIds.has(e.sessionId) ? { ...e, sessionId: null } : e)),
  )
}
