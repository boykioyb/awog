// Danh sách thread Slack đang theo dõi: `~/.awog/slack/threads.json`.
//
// Global chứ không theo project: thread thuộc về NGƯỜI (trao đổi với khách),
// project chỉ là nhãn lọc — cùng lý do logtime để dữ liệu ở `~/.awog`.
//
// File là L2 (đọc từ đĩa) ⇒ qua zod trước khi dùng. Mọi thao tác đọc-sửa-ghi đi
// qua `serialize` theo cùng một khoá: poll (60s) và markSeen/update (người bấm)
// chạy song song thường xuyên, ghi đè lẫn nhau thì chấm chưa đọc nhấp nháy sai.
// Đọc lại đĩa mỗi lần thay vì giữ bản RAM: file chỉ vài chục dòng, và không
// có cache thì không có chuyện cache lệch file.
import { join } from 'node:path'
import { z } from 'zod'
import { readJsonFile, serialize, slackHome, writeJsonAtomic } from './json-file.js'
import { CHANNEL_RE, TEAM_RE, THREAD_ID_RE, TS_RE } from './params.js'
import type { SlackThread } from './types.js'

const STORE_KEY = 'slack-threads'

const ThreadSchema = z.object({
  id: z.string().regex(THREAD_ID_RE),
  sourceId: z.string().min(1),
  teamId: z.string().regex(TEAM_RE),
  teamName: z.string(),
  teamUrl: z.string(),
  channelId: z.string().regex(CHANNEL_RE),
  channelName: z.string(),
  threadTs: z.string().regex(TS_RE),
  title: z.string().nullable(),
  firstLine: z.string(),
  projectId: z.string().nullable(),
  sessionId: z.string().nullable(),
  sessionSyncedTs: z.string().regex(TS_RE).nullable(),
  lastReplyTs: z.string().regex(TS_RE),
  lastSeenTs: z.string().regex(TS_RE),
  replyCount: z.number().int().min(0),
  addedAt: z.number(),
  error: z.enum(['not_found', 'no_access']).nullable(),
})

const FileSchema = z.object({
  version: z.literal(1),
  threads: z.array(ThreadSchema),
})

function storeFile(): string {
  return join(slackHome(), 'threads.json')
}

async function readAll(): Promise<SlackThread[]> {
  const doc = await readJsonFile(storeFile(), FileSchema)
  return doc?.threads ?? []
}

async function writeAll(threads: SlackThread[]): Promise<void> {
  await writeJsonAtomic(storeFile(), { version: 1, threads })
}

export function listThreads(): Promise<SlackThread[]> {
  return serialize(STORE_KEY, readAll)
}

export async function getThread(id: string): Promise<SlackThread | null> {
  return (await listThreads()).find((t) => t.id === id) ?? null
}

export class ThreadNotFoundError extends Error {
  constructor(id: string) {
    super(`Slack thread not tracked: ${id}`)
    this.name = 'ThreadNotFoundError'
  }
}

export async function requireThread(id: string): Promise<SlackThread> {
  const thread = await getThread(id)
  if (!thread) throw new ThreadNotFoundError(id)
  return thread
}

// Thêm nếu chưa có; đã có thì trả bản cũ NGUYÊN VẸN (không đè lastSeenTs,
// title… người dùng đã chỉnh). `created` cho caller biết để phát event.
export function insertThread(thread: SlackThread): Promise<{ thread: SlackThread; created: boolean }> {
  return serialize(STORE_KEY, async () => {
    const all = await readAll()
    const existing = all.find((t) => t.id === thread.id)
    if (existing) return { thread: existing, created: false }
    await writeAll([...all, thread])
    return { thread, created: true }
  })
}

export function removeThread(id: string): Promise<boolean> {
  return serialize(STORE_KEY, async () => {
    const all = await readAll()
    const kept = all.filter((t) => t.id !== id)
    if (kept.length === all.length) return false
    await writeAll(kept)
    return true
  })
}

// Sửa một thread bằng hàm thuần. Hàm trả null = không đổi gì ⇒ không ghi đĩa.
export function mutateThread(
  id: string,
  fn: (t: SlackThread) => SlackThread | null,
): Promise<SlackThread> {
  return serialize(STORE_KEY, async () => {
    const all = await readAll()
    const idx = all.findIndex((t) => t.id === id)
    const current = all[idx]
    if (idx < 0 || !current) throw new ThreadNotFoundError(id)
    const next = fn(current)
    if (!next || JSON.stringify(next) === JSON.stringify(current)) return current
    const copy = [...all]
    copy[idx] = next
    await writeAll(copy)
    return next
  })
}

// Áp nhiều cập nhật trong MỘT lần ghi (một vòng poll chạm nhiều thread).
// Trả id các thread thực sự đổi.
export function mutateThreads(
  updates: ReadonlyMap<string, (t: SlackThread) => SlackThread>,
): Promise<string[]> {
  return serialize(STORE_KEY, async () => {
    const all = await readAll()
    const changed: string[] = []
    const next = all.map((t) => {
      const fn = updates.get(t.id)
      if (!fn) return t
      const updated = fn(t)
      if (JSON.stringify(updated) === JSON.stringify(t)) return t
      changed.push(t.id)
      return updated
    })
    if (changed.length > 0) await writeAll(next)
    return changed
  })
}

// So sánh ts Slack (`1234567890.123456`). KHÔNG dùng Number(): 16 chữ số chạm
// giới hạn chính xác của double, hai reply cách nhau 1µs có thể bằng nhau.
function tsValue(ts: string): bigint {
  const [sec = '0', frac = ''] = ts.split('.')
  return BigInt(sec) * 1_000_000n + BigInt(frac.padEnd(6, '0').slice(0, 6) || '0')
}

export function tsAfter(a: string, b: string): boolean {
  return tsValue(a) > tsValue(b)
}

export function maxTs(a: string, b: string): string {
  return tsAfter(a, b) ? a : b
}
