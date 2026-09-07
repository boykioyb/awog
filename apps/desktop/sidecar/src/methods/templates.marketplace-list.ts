// Duyệt / tìm template trong danh mục AWOG công bố (gói #37). Đây là bản DUYỆT
// ĐƯỢC của `templates.fetchRemote`: dán URL thủ công vẫn còn nguyên, method này
// chỉ thêm đường vào cho người chưa biết link nào tồn tại.
//
// KHÔNG ghi gì, KHÔNG tải bundle nào — kết quả chỉ là metadata để hiển thị.
// `origin`/`stale`/`error` trả nguyên trạng lên UI để người dùng biết mình đang
// xem dữ liệu mạng, cache cũ, hay danh sách rỗng vì offline.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { loadMarketplace } from '../templates/marketplace.js'

const Params = z.object({
  query: z.string().max(200).optional(),
  refresh: z.boolean().optional(),
})

register('templates.marketplaceList', async (raw) => {
  const p = Params.parse(raw ?? {})
  return loadMarketplace({
    query: (p.query ?? '').trim(),
    ...(p.refresh ? { refresh: true } : {}),
  })
})
