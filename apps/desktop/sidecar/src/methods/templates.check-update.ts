import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { checkTemplateUpdate } from '../templates/update.js'

// templates.checkUpdate — hỏi nguồn GitHub của một template đã cài xem có bản
// mới không (WP10). So bằng git blob SHA-1 lấy từ tree entry nên KHÔNG tải blob;
// trả về từng entity thêm / đổi / xoá, kèm cờ `localModified` + `conflict` cho
// những entity người dùng đã sửa tay. Template không có `.install.json` (export
// tại chỗ) trả `hasRemote: false` chứ không phải lỗi.
const Params = z.object({ id: z.string().min(1).max(120) })

register('templates.checkUpdate', async (raw) => {
  const { id } = Params.parse(raw)
  const check = await checkTemplateUpdate(id)
  return { check }
})
