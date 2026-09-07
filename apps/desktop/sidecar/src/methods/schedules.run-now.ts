import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runScheduleNow } from '../schedules/runner.js'
import { SCHEDULE_ID_RE } from '../schedules/schema.js'

const Params = z.object({ id: z.string().regex(SCHEDULE_ID_RE) })

// "Chạy ngay" — bấm cò ngoài nhịp. Trả về dòng lịch sử ở trạng thái `running`
// (việc thật chạy tách rời); UI theo dõi tiếp qua event `schedules.changed`.
register('schedules.runNow', async (raw) => {
  const { id } = Params.parse(raw)
  return { run: await runScheduleNow(id) }
})
