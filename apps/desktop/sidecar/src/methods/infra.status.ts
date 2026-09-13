// Máy này có CLI hạ tầng nào (ADR 0088 §3). Chỉ đọc: không chạm tài khoản nào,
// chỉ dò binary trong allowlist rồi hỏi phiên bản. Thiếu binary KHÔNG phải lỗi —
// UI dùng kết quả này để hiện hướng dẫn cài đặt thay vì để người dùng bấm vào
// một nút chết.
import { register } from '../transport/rpc.js'
import { infraBinaryStatus } from '../infra/binary.js'

register('infra.status', async () => {
  return { tools: await infraBinaryStatus() }
})
