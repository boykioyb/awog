// Run a command IN an existing interactive SSH shell so it executes LIVE in the
// terminal the user is watching (SSH terminal co-pilot, ADR 0064). Returns the
// command's captured output + exit code. Unlike ssh.exec (hidden channel), this
// drives the visible PTY. Used by the agent ssh_terminal_run tool.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sshManager } from '../ssh/manager.js'

const Params = z.object({
  connId: z.string().min(1).max(64),
  command: z.string().min(1).max(100_000),
})

register(
  'ssh.runInShell',
  async (raw): Promise<{ output: string; exitCode: number }> => {
    const params = Params.parse(raw)
    return sshManager.runInShell(params.connId, params.command)
  },
)
