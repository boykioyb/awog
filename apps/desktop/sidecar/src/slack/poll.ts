// Một vòng poll: hỏi Slack thread nào có reply mới, cập nhật store, phát
// `slack.changed`.
//
// Nhịp do renderer quyết (thread đang mở 20s, còn lại 60s) và gọi `slack.poll`
// — sidecar không tự chạy timer: renderer biết cửa sổ nào đang mở, thread nào
// đang xem; sidecar tự poll thì vẫn chạy khi không ai nhìn.
//
// Mỗi thread một lần `conversations.replies` với `oldest=lastReplyTs`,
// `inclusive=false`, limit nhỏ: Slack luôn trả tin gốc ở đầu kèm
// `latest_reply` + `reply_count` (đo 2026-10-16) — đó mới là số liệu cần, phần
// reply mới chỉ để dự phòng khi tin gốc thiếu `latest_reply`.
import { log } from '../util/logger.js'
import { SlackApiError, isAuthErrorCode } from './client.js'
import { mapLimit } from './concurrency.js'
import { RepliesSchema } from './payload.js'
import { emitSlackChanged } from './rpc.js'
import { openSlackSession, type SlackSession } from './session.js'
import { TS_RE } from './params.js'
import { listThreads, maxTs, mutateThreads } from './store.js'
import { threadErrorOf, validTsOr } from './threads.js'
import type { SlackThread } from './types.js'

const POLL_LIMIT = 10
const POLL_CONCURRENCY = 3
// Hai cửa sổ (chính + Slack riêng) cùng chạy timer poll, cộng thêm poll khi focus
// lại cửa sổ ⇒ cùng một thread bị hỏi dồn vài lần trong vài giây. Thread vừa poll
// trong khoảng này thì bỏ qua (trừ `force` — người dùng bấm làm mới).
export const POLL_MIN_INTERVAL_MS = 15_000

// In-memory theo threadId: khởi động lại engine thì poll lại từ đầu là đúng ý.
const lastPolledAt = new Map<string, number>()

type Update = (t: SlackThread) => SlackThread

async function pollOne(session: SlackSession, thread: SlackThread): Promise<Update | null> {
  try {
    const data = await session.api('conversations.replies', {
      channel: thread.channelId,
      ts: thread.threadTs,
      oldest: thread.lastReplyTs,
      inclusive: false,
      limit: POLL_LIMIT,
    })
    const parsed = RepliesSchema.safeParse(data)
    if (!parsed.success) return null
    // ts là payload L1: lệch TS_RE thì không đưa vào so sánh/không ghi store.
    const msgs = parsed.data.messages.filter((m) => TS_RE.test(m.ts))
    const parent = msgs.find((m) => m.ts === thread.threadTs)
    const newest = msgs.reduce((acc, m) => maxTs(acc, m.ts), thread.lastReplyTs)
    // `latest_reply` của tin gốc là sự thật (kể cả khi reply mới nhất bị xoá
    // làm nó lùi lại); chỉ khi vắng (hoặc sai dạng) mới tự suy từ các reply thấy được.
    const lastReplyTs = validTsOr(parent?.latest_reply, newest)
    const replyCount = parent?.reply_count ?? thread.replyCount
    return (t) => ({ ...t, lastReplyTs, replyCount, error: null })
  } catch (err) {
    const code = err instanceof SlackApiError ? err.code : 'unknown'
    const gone = threadErrorOf(code)
    if (gone) return (t) => ({ ...t, error: gone })
    // Lỗi xác thực ném lên để bỏ cả nguồn; lỗi tạm (mạng, 429) bỏ qua thread
    // này, vòng sau thử lại.
    if (isAuthErrorCode(code)) throw err
    log.warn('slack: poll failed for thread', { threadId: thread.id, code })
    return null
  }
}

export async function pollThreads(
  threadIds?: readonly string[],
  opts: { force?: boolean } = {},
): Promise<string[]> {
  const all = await listThreads()
  const wanted = threadIds ? new Set(threadIds) : null
  const now = Date.now()
  const targets = (wanted ? all.filter((t) => wanted.has(t.id)) : all).filter((t) => {
    if (opts.force) return true
    const last = lastPolledAt.get(t.id)
    return last === undefined || now - last >= POLL_MIN_INTERVAL_MS
  })
  if (targets.length === 0) return []
  // Đánh dấu TRƯỚC khi gọi Slack: lời gọi thứ hai đến trong lúc vòng này còn chạy
  // cũng phải thấy thread "vừa poll". Lỗi tạm thì vòng sau (≥15s) thử lại.
  for (const t of targets) lastPolledAt.set(t.id, now)
  // Thread đã bỏ theo dõi không được giữ mục trong Map mãi.
  const tracked = new Set(all.map((t) => t.id))
  for (const id of lastPolledAt.keys()) {
    if (!tracked.has(id)) lastPolledAt.delete(id)
  }

  const bySource = new Map<string, SlackThread[]>()
  for (const t of targets) {
    const list = bySource.get(t.sourceId)
    if (list) list.push(t)
    else bySource.set(t.sourceId, [t])
  }

  const updates = new Map<string, Update>()
  for (const [sourceId, threads] of bySource) {
    let session: SlackSession
    try {
      // eslint-disable-next-line no-await-in-loop -- 1–2 nguồn
      session = await openSlackSession(sourceId)
    } catch (err) {
      // Nguồn mất kết nối: UI đã có banner từ slack.status; poll im lặng.
      log.warn('slack: poll skipped source', {
        sourceId,
        code: err instanceof SlackApiError ? err.code : 'unknown',
      })
      continue
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const results = await mapLimit(threads, POLL_CONCURRENCY, (t) => pollOne(session, t))
      threads.forEach((t, i) => {
        const fn = results[i]
        if (fn) updates.set(t.id, fn)
      })
    } catch (err) {
      log.warn('slack: poll aborted for source', {
        sourceId,
        code: err instanceof SlackApiError ? err.code : 'unknown',
      })
    }
  }
  if (updates.size === 0) return []
  const changed = await mutateThreads(updates)
  emitSlackChanged(changed)
  return changed
}
