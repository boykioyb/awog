import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listSessionSummaries } from '../sessions/store.js'
import { listTasks } from '../tasks/store.js'
import { buildLogtimeSuggestions } from '../logtime/suggestions.js'
import { loadSettings } from '../logtime/store.js'

// Việc AWOG đo được trong một ngày — panel "Hôm nay bạn đã làm" gọi cái này khi mở
// tab Ngày hoặc đổi ngày.
//
// Tốn kém có kiểm soát: `listSessionSummaries` chỉ đọc header đang nằm trong map ấm
// (ADR 0048) chứ không nạp transcript, còn `listTasks` đọc mỗi task một file JSON nhỏ.
// Không đọc logtime ở đây — chuyện ẩn những gợi ý đã được khai là việc của UI, nơi giữ
// danh sách dòng của ngày một cách reactive; lọc ở sidecar thì bảng không tự cập nhật
// khi người dùng vừa thêm một dòng.
//
// NHƯNG lọc theo "dự án đã nối PMS" thì đọc `settings.links` ở đây: đó không phải trạng
// thái reactive của ngày, mà là cấu hình chỉ đổi ở tab Thiết lập — và một gợi ý của dự
// án chưa nối là dòng không đẩy được, không nên mời bấm ngay từ đầu.
const Params = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })

register('logtime.suggestions', async (raw) => {
  const { date } = Params.parse(raw)
  const [sessions, tasks, settings] = await Promise.all([
    listSessionSummaries(),
    listTasks(),
    loadSettings(),
  ])
  // Chỉ link đã có `pmsProjectId` mới tính là "đã nối" — link dựng dở (chọn dự án PMS
  // nhưng chưa lưu) chưa đẩy được, đúng bằng `canPush` phía store dùng.
  const trackedProjectKeys = new Set(
    settings.links.filter((l) => !!l.pmsProjectId).map((l) => l.projectKey),
  )
  return buildLogtimeSuggestions({ date, sessions, tasks, trackedProjectKeys })
})
