import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { InboxError, MAX_TEXT_LEN, postSessionMessage } from '../sessions/inbox.js'

// Đặt một tin vào hộp thư của một phiên (gói #17) — nửa "gửi" của kênh nhắn tin
// giữa các phiên. Đây là đường của NGƯỜI DÙNG (nút "gửi sang phiên khác" trên UI);
// đường của model là tool `send_session_message`, gọi thẳng cùng một hàm lõi.
//
// Tên tách bạch với `sessions.sendMessage`: cái kia BẮT ĐẦU một lượt chat, cái này
// chỉ xếp một tin vào hàng đợi — không lượt nào chạy, không đồng nào tiêu, cho tới
// khi người dùng bấm giao ở phiên đích.
//
// Payload là L1: schema là biên kiểm tra. `from` KHÔNG có trong payload — RPC này
// luôn là "người dùng gửi", nên không có cách nào giả danh một phiên khác để né
// trần chống-lặp (trần đó tính theo phiên gửi).
const Params = z.object({
  // Phiên NHẬN.
  sessionId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  text: z.string().min(1).max(MAX_TEXT_LEN),
})

register('sessions.postMessage', async (raw) => {
  const params = Params.parse(raw)
  try {
    const message = await postSessionMessage({ from: null, to: params.sessionId, text: params.text })
    return { messageId: message.id, at: message.at }
  } catch (err) {
    // Từ chối có lý do (đích không tồn tại / đã lưu trữ / quá dài) là lỗi của lời
    // gọi, không phải sự cố nội bộ — trả nguyên câu giải thích cho UI hiển thị.
    if (err instanceof InboxError) throw new RpcError(-32602, err.message, { code: err.code })
    throw err
  }
})
