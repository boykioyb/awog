import { register } from '../transport/rpc.js'
import { listSchedules } from '../schedules/store.js'

// Toàn bộ lịch đã lưu (`~/.awog/schedules/*.json`), đã validate. File hỏng bị bỏ
// qua ở tầng store kèm log — danh sách không bao giờ chết vì một file lỗi.
register('schedules.list', async () => ({ schedules: await listSchedules() }))
