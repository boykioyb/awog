import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { readBackground } from '../sessions/bg-registry.js'

// Đọc output của MỘT job nền (ADR 0066) cho NGƯỜI DÙNG xem — modal "View output"
// trên chip job nền. Bọc `readBackground()` sẵn có, tức vẫn chỉ một nơi duy nhất
// dựng path tới `~/.awog/sessions/<sid>/bg/<shellId>/log`.
//
// Khác đường tool `BashOutput` đúng hai điểm:
//  1. `markRead` mặc định FALSE. Người dùng mở modal KHÔNG phải "model đã đọc kết
//     quả"; đánh dấu ở đây sẽ retire oan cái chip mà model chưa hề đọc.
//  2. `raw: true` — trả đuôi log thô kèm cờ `truncated`/`droppedBytes` để UI tự nói
//     bằng ngôn ngữ của nó, thay vì chèn dòng chú thích tiếng Anh vào giữa output.
//
// Bảo mật (invariant #2): `shellId` đi vào `path.join` nên chặn ngay ở biên —
// charset hẹp, cấm `..` và mọi dấu phân cách; `bg-registry` còn `sanitizeChild()`
// một lớp nữa. Thư mục cha luôn dựng từ `sessionId` của chính request, nên không
// có cách nào đọc output của session khác (id sai ⇒ 'not found', không phải rò rỉ).
const SAFE_ID = /^[A-Za-z0-9._:-]+$/

const Id = z
  .string()
  .min(1)
  .max(128)
  .regex(SAFE_ID, 'illegal id')
  .refine((v) => !v.includes('..'), 'illegal id')

const Params = z.object({
  sessionId: Id,
  shellId: Id,
  markRead: z.boolean().optional(),
})

register('sessions.backgroundRead', (raw) => {
  const { sessionId, shellId, markRead = false } = Params.parse(raw)
  const result = readBackground(sessionId, shellId, { markRead, raw: true })
  if (!result) throw new RpcError(-32004, 'Background shell not found')
  return {
    shellId: result.shellId,
    status: result.status,
    exitCode: result.exitCode,
    output: result.output,
    truncated: result.truncated,
    droppedBytes: result.droppedBytes,
    // Job nền của nhánh Claude SDK chạy trong tiến trình CLI: không có file log,
    // rỗng là ĐÚNG bản chất — UI nói riêng chuyện đó, không báo lỗi.
    external: result.external,
  }
})
