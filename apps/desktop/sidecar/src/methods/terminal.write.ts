import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { terminalManager } from '../terminal/manager.js'

const Params = z.object({
  terminalId: z.string().min(1),
  // Raw keystrokes — opaque bytes piped to the PTY's stdin (no shell concat).
  data: z.string(),
})

register('terminal.write', (raw): { ok: true } => {
  const params = Params.parse(raw)
  terminalManager.write(params.terminalId, params.data)
  return { ok: true }
})
