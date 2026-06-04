import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { terminalManager } from '../terminal/manager.js'

const Params = z.object({
  terminalId: z.string().min(1),
  cols: z.number().int().positive().max(1000),
  rows: z.number().int().positive().max(1000),
})

register('terminal.resize', (raw): { ok: true } => {
  const params = Params.parse(raw)
  terminalManager.resize(params.terminalId, params.cols, params.rows)
  return { ok: true }
})
