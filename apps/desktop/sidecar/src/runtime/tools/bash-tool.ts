// Bash AgentTool for the Pi runtime (ADR 0029). One-shot command capture scoped
// to the session cwd — NOT the interactive node-pty terminal. Mirrors Claude
// Code's Bash tool name + `command` arg-key so step-mapper renders it as a
// terminal step. Permission gating happens upstream in beforeToolCall (mode
// ask/plan blocks exec); this tool just runs + captures.
//
// Security: spawned via `sh -c <command>` with cwd = workspaceRoot. The command
// string is opaque user/model input (input L1) but the permission gate
// (beforeToolCall) is the control point — execute mode is the user's explicit
// "full access" choice, matching the sdk branch's Bash behaviour. Output is
// captured + capped; never logged with the command verbatim.

import { spawn } from 'node:child_process'
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const MAX_OUTPUT_BYTES = 64 * 1024

// Env allowlist mirrors git/runner.ts — the child inherits only what it needs
// to find tools, never AWOG's credential env.
const ALLOW_ENV = ['PATH', 'HOME', 'SHELL', 'LANG', 'LC_ALL', 'SystemRoot', 'USERPROFILE', 'TMPDIR'] as const

function filteredEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const k of ALLOW_ENV) {
    const v = process.env[k]
    if (v !== undefined) out[k] = v
  }
  return out
}

const BashParams = Type.Object({
  command: Type.String({ description: 'The shell command to run (executed via sh -c).' }),
  timeout: Type.Optional(
    Type.Number({ description: `Timeout in ms (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).` }),
  ),
})

interface BashDetails {
  command: string
  exitCode: number | null
}

function clampOutput(buf: string): string {
  if (buf.length <= MAX_OUTPUT_BYTES) return buf
  return `${buf.slice(0, MAX_OUTPUT_BYTES)}\n…(output truncated)`
}

export function createBashTool(cwd: string): AgentTool<typeof BashParams, BashDetails> {
  return {
    name: 'Bash',
    label: 'Run',
    description: 'Run a shell command in the workspace directory and capture its output.',
    parameters: BashParams,
    async execute(_id, params, signal): Promise<AgentToolResult<BashDetails>> {
      const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
      return new Promise<AgentToolResult<BashDetails>>((resolveResult) => {
        const child = spawn('sh', ['-c', params.command], {
          cwd,
          env: filteredEnv(),
          windowsHide: true,
        })
        let stdout = ''
        let stderr = ''
        let settled = false
        const finish = (exitCode: number | null, extra?: string): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
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
