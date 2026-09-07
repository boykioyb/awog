import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listSessionContacts } from '../sessions/inbox.js'

// Danh bạ phiên (gói #17): những phiên có thể chọn làm ĐÍCH cho một tin nhắn —
// đang chạy một lượt, hoặc vừa hoạt động trong 24h và chưa lưu trữ.
//
// Chỉ trả đủ để chọn đích: id, tiêu đề (đã cắt một dòng), project, có đang bận
// không. KHÔNG trả preview/transcript — nội dung của phiên khác không được rò
// sang bề mặt đang hỏi (kể cả UI lẫn model).
//
// Tên `listAgents` giữ theo tên gọi của tính năng ("nhắn tin giữa các agent"):
// với người dùng, mỗi phiên đang chạy LÀ một agent đang làm việc.
const Params = z.object({
  // Phiên đang hỏi — bị loại khỏi kết quả (tự nhắn cho mình là vòng lặp hiển
  // nhiên) và dùng để đếm "bạn đã gửi bao nhiêu tin tới phiên này gần đây".
  sessionId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
})

register('sessions.listAgents', async (raw) => {
  const params = Params.parse(raw)
  return { sessions: await listSessionContacts(params.sessionId ?? null) }
})
