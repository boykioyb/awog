import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { terminalManager, type TerminalSessionRef } from '../terminal/manager.js'

const Params = z.object({
  sessionId: z.string().optional(),
})

register('terminal.list', (raw): { terminals: TerminalSessionRef[] } => {
  const params = Params.parse(raw)
  return { terminals: terminalManager.list(params.sessionId) }
})
