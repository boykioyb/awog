import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { terminalManager } from '../terminal/manager.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  sessionId: z.string().min(1),
  cols: z.number().int().positive().max(1000),
  rows: z.number().int().positive().max(1000),
})

// Expand a leading "~" so the global terminal can ask for the home directory by
// passing "~" (the UI never needs the absolute home path). No shell is invoked,
// so glob/$VAR are intentionally NOT expanded — mirrors projects.upsert.
function expandHome(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return resolve(homedir(), input.slice(2))
  return input
}

register('terminal.create', async (raw): Promise<{ terminalId: string }> => {
  const params = Params.parse(raw)
  return terminalManager.create({ ...params, workspaceRoot: expandHome(params.workspaceRoot) })
})
