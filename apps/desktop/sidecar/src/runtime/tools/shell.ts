// Shell resolution for the one-shot Bash AgentTool (ADR 0029). This is SEPARATE
// from the interactive PTY's defaultShell() in terminal/manager.ts: that one
// launches an interactive shell the user types into, whereas this runs a single
// `<flag> <command>` exec and captures the output for the model.
//
// Contract: AWOG agent commands, skills, and slash-commands are authored in POSIX
// shell syntax (ls/grep/cat/&&/pipes). So we run them through a POSIX shell on
// EVERY platform:
//   - POSIX (mac/linux): `sh -c <command>` — sh is always present.
//   - Windows: probe for a bash (git-bash install dirs, then `bash` on PATH for
//     git-bash-on-PATH / WSL) and run `bash -c <command>`, keeping the POSIX
//     contract so existing prompts work unchanged.
//   - Windows with no bash: degrade to `cmd.exe /c <command>` so the tool returns
//     a real (if usually failing) result instead of an ENOENT crash, and log a
//     one-time hint to install Git for Windows.
//
// The plan is memoized — the probe runs at most once per engine lifetime.

import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { log } from '../../util/logger.js'

const PROBE_TIMEOUT_MS = 5_000

// `flag` is '-c' for a POSIX shell and '/c' for cmd.exe.
export type ShellPlan = { bin: string; flag: string }

const POSIX_PLAN: ShellPlan = { bin: 'sh', flag: '-c' }

// git-bash install locations, most-common first. Built from the sidecar's own
// process.env (full env — the allowlist only restricts the CHILD's env), so these
// Windows-only vars are read safely even though they are stripped from spawns.
function windowsBashCandidates(): string[] {
  const roots = [
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
  ].filter((v): v is string => typeof v === 'string' && v.length > 0)
  const candidates = roots.map((root) => `${root}\\Git\\bin\\bash.exe`)
  const localApp = process.env.LOCALAPPDATA
  if (localApp) candidates.push(`${localApp}\\Programs\\Git\\bin\\bash.exe`)
  return candidates
}

// `<bin> --version` succeeds => bin is runnable on PATH. Used as the last resort
// before the cmd.exe fallback on Windows.
function probeBin(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (err) => {
      resolve(!err)
    })
  })
}

async function resolvePlan(): Promise<ShellPlan> {
  if (process.platform !== 'win32') return POSIX_PLAN

  for (const candidate of windowsBashCandidates()) {
    if (existsSync(candidate)) return { bin: candidate, flag: '-c' }
  }
  if (await probeBin('bash')) return { bin: 'bash', flag: '-c' }

  log.warn(
    'bash-tool: no POSIX shell (bash) found on Windows — falling back to cmd.exe. ' +
      'Most agent commands assume a POSIX shell; install Git for Windows for full support.',
  )
  return { bin: process.env.COMSPEC ?? 'cmd.exe', flag: '/c' }
}

let planPromise: Promise<ShellPlan> | null = null

// Resolve the shell the Bash tool should spawn. Memoized for the engine lifetime.
export function resolveBashShell(): Promise<ShellPlan> {
  if (!planPromise) planPromise = resolvePlan()
  return planPromise
}

// Env allowlist for shell-outs (the one-shot Bash tool AND the background-exec
// registry, ADR 0066) — mirrors git/runner.ts. The child inherits only what it
// needs to find tools, never AWOG's credential env.
const ALLOW_ENV = [
  'PATH',
  'HOME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'SystemRoot',
  'USERPROFILE',
  'TMPDIR',
] as const

// Build the filtered env for a spawned shell command. DO_NOT_TRACK is set as
// defense-in-depth for AWOG invariant #5 (no telemetry): any tool the command
// shells out to that honors the standard can never phone home.
export function filteredShellEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const k of ALLOW_ENV) {
    const v = process.env[k]
    if (v !== undefined) out[k] = v
  }
  out.DO_NOT_TRACK = '1'
  return out
}
