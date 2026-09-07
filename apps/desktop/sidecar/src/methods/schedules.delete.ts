import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteSchedule } from '../schedules/store.js'
import { SCHEDULE_ID_RE } from '../schedules/schema.js'

const Params = z.object({ id: z.string().regex(SCHEDULE_ID_RE) })

// Xoá chỉ gỡ định nghĩa lịch. Phiên / task mà nó đã tạo là dữ liệu thật của
// người dùng, không đụng tới.
register('schedules.delete', async (raw) => {
  const { id } = Params.parse(raw)
  await deleteSchedule(id)
  return { ok: true }
})
