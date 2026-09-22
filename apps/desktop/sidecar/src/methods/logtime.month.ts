import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { loadMonth, loadSettings } from '../logtime/store.js'

// Một tháng công + cấu hình hiện hành. UI gọi cái này khi mở trang / đổi tháng.
const Params = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
})

register('logtime.month', async (raw) => {
  const { month } = Params.parse(raw)
  const [doc, settings] = await Promise.all([loadMonth(month), loadSettings()])
  return { month: doc, settings }
})
