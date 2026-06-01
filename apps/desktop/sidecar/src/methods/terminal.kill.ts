import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { terminalManager } from '../terminal/manager.js'

const Params = z.object({
  terminalId: z.string().min(1),
})

register('terminal.kill', (raw): { ok: true } => {
  const params = Params.parse(raw)
  terminalManager.kill(params.terminalId)
  return { ok: true }
})
