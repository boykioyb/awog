import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { saveDay } from '../logtime/store.js'

// Ghi đè nguyên một ngày (ADR 0091 D-4). Trần giờ do UI cưỡng chế trước khi gọi;
// ở đây chỉ kiểm biên của TỪNG dòng (0.25–24) vì đó là ràng buộc của PMS.
const Entry = z.object({
  id: z.string().optional(),
  projectKey: z.string().min(1),
  note: z.string().max(2000).optional(),
  hours: z.number(),
  task: z
    .object({
      id: z.string().optional(),
      issue: z.number().optional(),
      title: z.string().optional(),
    })
    .optional(),
  status: z.enum(['draft', 'posted', 'locked']).optional(),
  worklogId: z.string().optional(),
  lockedAt: z.string().optional(),
})

const Params = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z.array(Entry).max(40),
})

register('logtime.save-day', async (raw) => {
  const { date, entries } = Params.parse(raw)
  return await saveDay(date, entries)
})
