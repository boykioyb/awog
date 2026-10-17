// slack.thread.get → nội dung một thread để hiển thị. `cursor` (lấy từ
// `nextCursor` lần trước) tải các reply CŨ hơn — trang đầu là reply mới nhất,
// đúng thứ tự Slack trả. Thread đã bị xoá/mất quyền thì trả `thread.error` và
// `messages: []` thay vì lỗi, để UI hiện trạng thái ngay trong khung đọc.
import { z } from 'zod'
import { ThreadIdSchema } from '../slack/params.js'
import { registerSlack } from '../slack/rpc.js'
import { getThreadDetail, type ThreadDetailPage } from '../slack/threads.js'

const Params = z.object({
  threadId: ThreadIdSchema,
  // Cursor Slack: base64-ish, mờ với ta — chỉ chặn độ dài và ký tự lạ.
  cursor: z
    .string()
    .max(500)
    .regex(/^[A-Za-z0-9=_+/:-]+$/)
    .optional(),
  // Số reply mỗi trang. UI mở thread chỉ xin vài tin mới nhất (bấm "Tải tin cũ hơn"
  // mới lấy thêm) — thread dài không phải kéo cả trăm tin + dịch hết ngay lúc mở.
  limit: z.number().int().min(1).max(200).optional(),
})

registerSlack('slack.thread.get', async (raw): Promise<ThreadDetailPage> => {
  const p = Params.parse(raw)
  return getThreadDetail(p.threadId, p.cursor, p.limit)
})
