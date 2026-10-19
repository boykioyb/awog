import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { emit } from '../transport/stdio.js'
import { firstRunAfter } from '../schedules/cron.js'
import { loadSchedule, saveSchedule } from '../schedules/store.js'
import { SCHEDULE_ID_RE } from '../schedules/schema.js'

// Bật/tắt một lịch — CHỈ cờ `enabled` (+ mốc kế tiếp), không nhận `job`. Trước đây nút
// bật/tắt gửi lại nguyên lịch qua `schedules.upsert`, tức gửi lại `job` đọc từ đĩa: với
// job `command`, đó là đường để một lệnh do agent cấy vào file lịch được "lưu" bằng một
// cú click không ai đọc lệnh (ADR 0108). Bật/tắt không bao giờ duyệt lệnh.
const Params = z.object({ id: z.string().regex(SCHEDULE_ID_RE), enabled: z.boolean() })

register('schedules.setEnabled', async (raw) => {
  const { id, enabled } = Params.parse(raw)
  const schedule = await loadSchedule(id)
  if (!schedule) throw new RpcError(-32602, `Schedule not found: ${id}`)
  // Lịch agent đề xuất chỉ thành thật qua Sửa → Lưu (đọc lại lịch, duyệt lệnh) — một cú
  // bật công tắc không phải là xem xét.
  if (enabled && schedule.proposedBy) {
    throw new RpcError(-32602, 'This schedule was proposed by an agent — open it, review it and save it to enable it')
  }
  if (schedule.enabled !== enabled) {
    const now = Date.now()
    // Bật lại ⇒ mốc tính từ bây giờ (mốc cũ đã trôi qua sẽ thành "chạy ngay"), y như upsert.
    const next = enabled ? firstRunAfter(schedule.trigger, now) : null
    schedule.enabled = enabled
    schedule.nextRunAt = next === null ? null : new Date(next).toISOString()
    schedule.updatedAt = new Date(now).toISOString()
    await saveSchedule(schedule)
    emit('schedules.changed', { id })
  }
  return { schedule }
})
