// Đọc TRỌN một thread (mọi trang) cho lớp session (session-link → khối đưa vào
// phiên AI). Bản duy nhất — đừng viết lại vòng phân trang ở chỗ khác.
//
// Phân trang `conversations.replies` (đo 2026-10-16, xem threads.ts): trang đầu là
// các reply MỚI NHẤT, `cursor` dẫn về reply CŨ hơn, tin gốc có mặt ở mọi trang.
import { log } from '../util/logger.js'
import { tsAfter } from './store.js'
import { getThreadDetail } from './threads.js'
import type { SlackThreadDetail } from './types.js'

// Trần số trang (200 tin/trang). Khối đưa vào phiên chỉ giữ ~6000 ký tự cuối, nên
// trần này chỉ chặn một thread hàng nghìn reply đốt rate-limit Slack cho phần sẽ
// bị cắt bỏ. Vì trang đầu là phần mới nhất, vượt trần thì cái bị bỏ là các reply
// CŨ NHẤT — đúng phần khối thread cũng sẽ lược trước.
const MAX_DETAIL_PAGES = 10

export class ThreadUnavailableError extends Error {
  constructor(threadId: string, reason: string) {
    super(`Slack thread ${threadId} is unavailable (${reason})`)
    this.name = 'ThreadUnavailableError'
  }
}

export async function loadFullThreadDetail(threadId: string): Promise<SlackThreadDetail> {
  const { nextCursor: firstCursor, ...first } = await getThreadDetail(threadId, undefined)
  // Thread đã xoá / mất quyền kênh: Slack trả trang rỗng kèm `error`. Đưa "không có
  // tin nào" vào phiên là nói sai — báo lỗi cho người bấm.
  if (first.thread.error) throw new ThreadUnavailableError(threadId, first.thread.error)

  const byTs = new Map(first.messages.map((m) => [m.ts, m]))
  const users = { ...first.users }
  const channels = { ...first.channels }
  const customEmoji = { ...first.customEmoji }
  let cursor = firstCursor
  for (let page = 1; cursor && page < MAX_DETAIL_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop -- cursor của trang sau nằm trong trang trước
    const next = await getThreadDetail(threadId, cursor)
    // Tin gốc có mặt ở mọi trang ⇒ Map theo ts tự bỏ trùng.
    for (const m of next.messages) byTs.set(m.ts, m)
    Object.assign(users, next.users)
    Object.assign(channels, next.channels)
    Object.assign(customEmoji, next.customEmoji)
    cursor = next.nextCursor
  }
  if (cursor) {
    log.warn('slack: thread exceeds page cap; oldest replies not loaded', { threadId })
  }

  // Trang sau là tin CŨ hơn ⇒ phải sắp lại: tin gốc trước, rồi theo thời gian.
  const parentTs = first.thread.threadTs
  const messages = [...byTs.values()].sort((a, b) => {
    if (a.ts === parentTs) return -1
    if (b.ts === parentTs) return 1
    if (tsAfter(a.ts, b.ts)) return 1
    return tsAfter(b.ts, a.ts) ? -1 : 0
  })
  return { ...first, messages, users, channels, customEmoji }
}
