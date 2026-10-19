import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { readRunLog, RUN_ID_RE } from '../schedules/run-log.js'
import { SCHEDULE_ID_RE } from '../schedules/schema.js'

// Log đầy đủ của một lượt chạy job `command` (ADR 0108) — cho nút "Log" trong lịch sử chạy.
// Hai id đều qua regex trước khi thành đường dẫn (schedules/run-log.ts còn sanitizeChild).
const Params = z.object({ id: z.string().regex(SCHEDULE_ID_RE), runId: z.string().regex(RUN_ID_RE) })

register('schedules.runLog', async (raw) => {
  const { id, runId } = Params.parse(raw)
  const text = await readRunLog(id, runId)
  if (text === null) throw new RpcError(-32602, `No log for run ${runId}`)
  return { text }
})
