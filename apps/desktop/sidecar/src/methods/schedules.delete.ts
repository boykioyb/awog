import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteSchedule, loadSchedule } from '../schedules/store.js'
import { revokeCommand } from '../schedules/command-approval.js'
import { deleteRunLogs } from '../schedules/run-log.js'
import { log } from '../util/logger.js'
import { SCHEDULE_ID_RE } from '../schedules/schema.js'

const Params = z.object({ id: z.string().regex(SCHEDULE_ID_RE) })

// Xoá chỉ gỡ định nghĩa lịch. Phiên / task mà nó đã tạo là dữ liệu thật của
// người dùng, không đụng tới.
register('schedules.delete', async (raw) => {
  const { id } = Params.parse(raw)
  const existing = await loadSchedule(id)
  await deleteSchedule(id)
  await deleteRunLogs(id)
  // Thu hồi dấu duyệt: một file lịch cùng id ghi lại sau này không được chạy theo dấu cũ.
  // Keychain lỗi thì lịch vẫn xoá — dòng sổ mồ côi không chạy được gì khi không có lịch.
  if (existing?.job.kind === 'command') {
    await revokeCommand(id).catch((err: unknown) => {
      log.warn('schedules: revoke failed', { id, err: err instanceof Error ? err.message : String(err) })
    })
  }
  return { ok: true }
})
