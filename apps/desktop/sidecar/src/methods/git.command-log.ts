// `git.commandLog` — read the ring buffer of git subprocesses this sidecar ran.
// The live feed is the `git:command` event; this is what a freshly-mounted (or
// reloaded) UI calls to fill in what it missed.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { clearGitCommands, listGitCommands, type GitCommandEntry } from '../git/command-log.js'

const Params = z.object({
  // Omit to see every workspace's commands (the log is process-wide).
  workspaceRoot: z.string().min(1).optional(),
  limit: z.number().int().positive().max(400).optional(),
})

register('git.commandLog', async (raw): Promise<{ entries: GitCommandEntry[] }> => {
  const params = Params.parse(raw)
  return { entries: listGitCommands(params.workspaceRoot, params.limit) }
})

register('git.commandLogClear', async (): Promise<{ ok: true }> => {
  clearGitCommands()
  return { ok: true as const }
})
