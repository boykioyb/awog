import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { terminalManager } from '../terminal/manager.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  sessionId: z.string().min(1),
  cols: z.number().int().positive().max(1000),
  rows: z.number().int().positive().max(1000),
})

register('terminal.create', async (raw): Promise<{ terminalId: string }> => {
  const params = Params.parse(raw)
  return terminalManager.create(params)
})
