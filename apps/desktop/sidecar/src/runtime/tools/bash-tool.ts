// Bash AgentTool for the Pi runtime (ADR 0029). One-shot command capture scoped
// to the session cwd — NOT the interactive node-pty terminal. Mirrors Claude
// Code's Bash tool name + `command` arg-key so step-mapper renders it as a
// terminal step. Permission gating happens upstream in beforeToolCall (mode
// ask/plan blocks exec); this tool just runs + captures.
//
// Security: spawned via a POSIX shell (`sh -c <command>`, or git-bash `bash -c`
// on Windows — see resolveBashShell) with cwd = workspaceRoot. The command string
// is opaque user/model input (input L1) but the permission gate (beforeToolCall)
// is the control point — execute mode is the user's explicit "full access" choice,
// matching the sdk branch's Bash behaviour. Output is captured + capped; never
// logged with the command verbatim.

import { spawn } from 'node:child_process'
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { resolveBashShell, filteredShellEnv } from './shell.js'
import {
  startBackground,
  BackgroundLimitError,
  type BgShellMeta,
} from '../../sessions/bg-registry.js'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const MAX_OUTPUT_BYTES = 64 * 1024

const BashParams = Type.Object({
  command: Type.String({ description: 'The shell command to run (executed via a POSIX shell, e.g. sh/bash -c).' }),
  timeout: Type.Optional(
    Type.Number({ description: `Timeout in ms (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).` }),
  ),
  run_in_background: Type.Optional(
    Type.Boolean({
      description:
        'Run the command detached in the background instead of waiting for it. ' +
        'Returns a shellId immediately (no 600s cap). Poll its output with BashOutput; ' +
        'the session is notified when it exits. Use for long tasks (builds, test runs, servers). ' +
        'Only honored in a chat session.',
    }),
  ),
})

interface BashDetails {
  command: string
  exitCode: number | null
  shellId?: string
}

// Background exec context (ADR 0066). Set ONLY by the chat runtime (sessions) —
// a session can be woken when the command exits. Absent for tasks/subagents, so
// run_in_background silently degrades to synchronous there.
export interface BashBackgroundContext {
  sessionId: string
}

function clampOutput(buf: string): string {
  if (buf.length <= MAX_OUTPUT_BYTES) return buf
  return `${buf.slice(0, MAX_OUTPUT_BYTES)}\n…(output truncated)`
}

export function createBashTool(
  cwd: string,
  bg?: BashBackgroundContext,
): AgentTool<typeof BashParams, BashDetails> {
  return {
    name: 'Bash',
    label: 'Run',
    description: bg
      ? 'Run a shell command in the workspace directory and capture its output. ' +
        'Pass run_in_background:true for long-running commands (builds, test runs, dev servers) ' +
        'to run detached and continue without blocking; poll with BashOutput.'
      : 'Run a shell command in the workspace directory and capture its output.',
    parameters: BashParams,
    async execute(_id, params, signal): Promise<AgentToolResult<BashDetails>> {
      // Background branch (ADR 0066): only in a chat session. Spawns detached and
      // returns immediately — the turn's abort signal must NOT kill it.
      if (params.run_in_background === true && bg) {
        try {
          const meta: BgShellMeta = await startBackground({
            sessionId: bg.sessionId,
            cwd,
            command: params.command,
          })
          return {
            content: [
              {
                type: 'text',
                text:
                  `Started in the background (shellId: ${meta.shellId}). This does NOT block — ` +
                  `the command keeps running detached. Poll its output with ` +
                  `BashOutput({ shell_id: "${meta.shellId}" }); you'll be notified when it exits ` +
                  `so you can continue. Don't wait on it here.`,
              },
            ],
            details: { command: params.command, exitCode: null, shellId: meta.shellId },
          }
        } catch (err) {
          const text =
            err instanceof BackgroundLimitError
              ? `${err.message} Wait for a background command to finish (check BashOutput) before starting another.`
              : `Failed to start background command: ${err instanceof Error ? err.message : String(err)}`
          return {
            content: [{ type: 'text', text }],
            details: { command: params.command, exitCode: null },
          }
        }
      }

      const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
      // Resolve the platform shell once (memoized): `sh -c` on POSIX, git-bash
      // `bash -c` on Windows, `cmd.exe /c` as a last-resort Windows fallback.
      const shell = await resolveBashShell()
      return new Promise<AgentToolResult<BashDetails>>((resolveResult) => {
        const child = spawn(shell.bin, [shell.flag, params.command], {
          cwd,
          env: filteredShellEnv(),
          windowsHide: true,
        })
        let stdout = ''
        let stderr = ''
        let settled = false
        const finish = (exitCode: number | null, extra?: string): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          // Detach the abort listener on completion. `{ once: true }` only
          // auto-removes when the event FIRES; without this, every finished
          // command leaves a dangling listener on the (long-lived) turn signal
          // → MaxListenersExceededWarning after ~10 commands in one turn.
          if (signal) signal.removeEventListener('abort', onAbort)
          // Append the exit code so the model can react to failures; we return a
          // structured result rather than throwing (the loop wants a tool result
          // here, and a non-zero exit is information, not a tool crash).
          const tail = exitCode !== null && exitCode !== 0 ? `\n(exit code ${exitCode})` : ''
          const merged = clampOutput(
            [stdout, stderr, extra ?? ''].filter(Boolean).join('\n').trimEnd() + tail,
          )
          resolveResult({
            content: [{ type: 'text', text: merged.trim() || `(no output, exit ${exitCode ?? 'null'})` }],
            details: { command: params.command, exitCode },
          })
        }
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          finish(null, `Command timed out after ${timeout}ms`)
        }, timeout)
        const onAbort = (): void => {
          child.kill('SIGKILL')
          finish(null, 'Command aborted')
        }
        if (signal) {
          if (signal.aborted) onAbort()
          else signal.addEventListener('abort', onAbort, { once: true })
        }
        child.stdout.on('data', (d: Buffer) => {
          if (stdout.length < MAX_OUTPUT_BYTES) stdout += d.toString('utf8')
        })
        child.stderr.on('data', (d: Buffer) => {
          if (stderr.length < MAX_OUTPUT_BYTES) stderr += d.toString('utf8')
        })
        child.on('error', (err) => finish(null, err.message))
        child.on('close', (code) => finish(code))
      })
    },
  }
}
