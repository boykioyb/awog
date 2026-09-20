import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { killProcess, type KillResult } from '../monitor/kill.js'

const Params = z.object({
  pid: z.number().int().positive(),
  // SIGKILL thay vì SIGTERM. UI chỉ đưa ra sau khi SIGTERM không ăn thua.
  force: z.boolean().optional(),
  // Có thì dừng tiến trình trên MÁY TỪ XA của kết nối SSH đó, không phải máy này.
  connId: z.string().min(1).max(64).optional(),
})

register('monitor.kill', async (raw): Promise<KillResult> => {
  const params = Params.parse(raw)
  return killProcess(params.pid, params.force === true, params.connId)
})
