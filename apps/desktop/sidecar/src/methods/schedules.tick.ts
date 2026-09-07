import { register } from '../transport/rpc.js'
import { tickSchedules } from '../schedules/runner.js'

// Nhịp quét, do bộ đếm giờ ở Electron main gọi (electron/src/scheduler.ts).
// Không tham số: "bây giờ" là đồng hồ của sidecar, để host không thể đẩy thời
// gian và ép một lịch chạy sớm.
register('schedules.tick', async () => tickSchedules())
