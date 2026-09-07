// Đọc nội dung THẬT của một bundle trong danh mục để dựng màn hình đồng ý (gói
// #37). Trả về đủ danh sách entity sẽ ghi (kể cả hook — script chạy được — và
// rule — đi thẳng vào system prompt), số file, tổng dung lượng, và `token` băm
// kế hoạch mà `templates.marketplaceInstall` bắt buộc phải nhận lại.
//
// Không ghi một byte nào xuống đĩa.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { inspectEntry } from '../templates/marketplace.js'

const Params = z.object({ id: z.string().min(1).max(120) })

register('templates.marketplaceInspect', async (raw) => {
  const { id } = Params.parse(raw)
  const inspection = await inspectEntry(id)
  return { inspection }
})
