// Duyệt / tìm MCP server trong registry công khai (gói #38). Đây là bản ĐỘNG của
// `source.listPresets`: catalog tĩnh vẫn còn nguyên và vẫn là thứ hiện đầu tiên,
// method này chỉ thêm phần cập nhật được mà không cần release app.
//
// Không có secret nào đi qua đây, và KHÔNG có gì được ghi hay chạy: kết quả chỉ
// là metadata để hiển thị. Việc cài đi qua source.discoverPreset (bản nháp) rồi
// source.upsert (người dùng bấm Save) — hai bước, người dùng nhìn thấy cả hai.
//
// `origin`/`stale`/`error` được trả nguyên trạng lên UI để người dùng biết mình
// đang xem dữ liệu mạng, cache cũ, hay không có gì (offline lần đầu).

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { loadCatalog, searchRegistry } from '../sources/registry.js'

const Params = z.object({
  query: z.string().max(200).optional(),
  refresh: z.boolean().optional(),
})

register('source.discoverRegistry', async (raw) => {
  const { query, refresh } = Params.parse(raw ?? {})
  const q = (query ?? '').trim()
  // Query rỗng ⇒ catalog nền (có cache, dùng được offline). Có query ⇒ hỏi thẳng
  // registry, và tự lọc cục bộ nếu mạng hỏng.
  return q ? searchRegistry(q) : loadCatalog(refresh ? { refresh: true } : {})
})
