// BashOutput AgentTool (ADR 0066). Lets the model poll a background shell started
// with `Bash(run_in_background: true)` — its accumulated output plus status/exit
// code. Read-only (reads files inside the session's bg/ folder), so it is NOT
// gated by the permission hook. Mirrors Claude Code's BashOutput tool name + the
// `shell_id` arg-key so the model, trained on that tool, uses it correctly.
//
// Only wired into a chat session (createBashOutputTool is called with the session
// id from run-stream). Tasks/subagents don't get background exec, so they don't
// get this tool.

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { readBackground } from '../../sessions/bg-registry.js'

const Params = Type.Object({
  shell_id: Type.String({
    description: 'The shellId returned by a prior Bash({ run_in_background: true }) call.',
  }),
})

interface BashOutputDetails {
  shellId: string
  status: string
  exitCode: number | null
}

export function createBashOutputTool(sessionId: string): AgentTool<typeof Params, BashOutputDetails> {
  return {
    name: 'BashOutput',
    label: 'Output',
    description:
      'Read the output and status of a background shell started with Bash(run_in_background:true). ' +
      "Returns the command's accumulated stdout+stderr plus whether it is still running or has exited " +
      '(with the exit code). Poll this to check on a long-running background command.',
    parameters: Params,
    async execute(_id, params): Promise<AgentToolResult<BashOutputDetails>> {
      const result = readBackground(sessionId, params.shell_id)
      if (!result) {
        return {
          content: [
            {
              type: 'text',
              text: `No background shell with id "${params.shell_id}" in this session.`,
            },
          ],
          details: { shellId: params.shell_id, status: 'unknown', exitCode: null },
        }
      }

      const header =
        result.status === 'running'
          ? `[${result.shellId}] still running`
          : result.status === 'exited'
            ? `[${result.shellId}] exited (code ${result.exitCode ?? 'unknown'})`
            : `[${result.shellId}] no longer tracked (exit status unknown — it may have been interrupted)`
      const body = result.output.trim() || '(no output yet)'
      return {
        content: [{ type: 'text', text: `${header}\n\n${body}` }],
        details: { shellId: result.shellId, status: result.status, exitCode: result.exitCode },
      }
    },
  }
}
