import { z } from 'zod'
import { register } from '../transport/rpc.js'
import {
  listCleanupActions,
  runCleanupAction,
  type CleanupAction,
  type CleanupResult,
} from '../monitor/cleanup.js'

// Hành động dọn có trên MÁY NÀY (dò từng công cụ). Chỉ đọc.
register('cleanup.actions', async (): Promise<{ actions: CleanupAction[] }> => ({
  actions: await listCleanupActions(),
}))

const RunParams = z.object({ id: z.string().min(1).max(64) })

// Chạy MỘT hành động theo `id`. UI không gửi lệnh — danh mục nằm ở sidecar, nên
// không có đường nào để một chuỗi từ renderer trở thành lệnh chạy.
register('cleanup.run', async (raw): Promise<CleanupResult> => {
  return runCleanupAction(RunParams.parse(raw).id)
})
