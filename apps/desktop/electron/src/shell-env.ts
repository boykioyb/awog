import { execSync } from 'node:child_process'
import { app } from 'electron'
import { log } from './logger'

// Shell environment loader (fixes the GUI-launch PATH problem).
//
// When an Electron app is launched from Finder/Dock (macOS) or a desktop
// launcher (Linux) instead of a terminal, it inherits a MINIMAL environment —
// on macOS PATH is just `/usr/bin:/bin:/usr/sbin:/sbin`, with no
// `/opt/homebrew/bin`. The engine (engine.ts) is spawned from this process, so
// its child shells inherit that stripped PATH too: the agent's Bash tool, the
// node-pty terminal and the git runner can't find Homebrew/nvm/pyenv tools
// (node, ripgrep, …). The model then sees the command fail and gives up on
// shell work.
//
// Fix: before the engine spawns, recover the user's REAL environment by running
// their login+interactive shell once and importing its env into process.env.
// This mirrors the approach used by craft-agents-oss (apps/electron/.../shell-env.ts)
// and the `fix-path`/`shell-env` npm packages — implemented inline so we add no
// dependency (AWOG rule: no new deps without an ADR).

// Marker separating the shell's own startup chatter from the `env` dump.
const ENV_MARKER = '__AWOG_SHELL_ENV__'
const SHELL_TIMEOUT_MS = 5_000

// Common tool directories prepended on the fallback path (login shell failed or
// timed out). Mostly macOS-oriented; harmless on Linux (missing dirs are deduped
// away by the resolver at exec time).
function fallbackDirs(): string[] {
  const dirs = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin']
  const home = process.env.HOME
  if (home) dirs.push(`${home}/.local/bin`, `${home}/.bun/bin`, `${home}/.cargo/bin`)
  return dirs
}

function prependPaths(dirs: string[]): void {
  const current = process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin'
  const merged = [...dirs, ...current.split(':')]
    .filter((p) => p.length > 0)
    .filter((p, i, arr) => arr.indexOf(p) === i) // dedupe, keep first occurrence
    .join(':')
  process.env.PATH = merged
}

// Recover the user's full shell environment and merge it into process.env.
// Call once, early in startup, BEFORE spawning the engine. No-op on Windows
// (PATH comes from the registry, not a login shell) and in dev (a terminal
// launch already carries the full environment).
export function loadShellEnv(): void {
  if (process.platform === 'win32') return
  if (!app.isPackaged) {
    log.info('[shell-env] skipped (dev build already has the terminal environment)')
    return
  }

  const shellBin = process.env.SHELL ?? '/bin/zsh'
  log.info('[shell-env] loading environment', { shell: shellBin })

  try {
    // -l (login) sources profile files (.zprofile/.profile); -i (interactive)
    // sources rc files (.zshrc/.bashrc) where Homebrew/version-managers usually
    // set PATH. Run with a clean, minimal env so we read the SHELL's PATH, not
    // ours. APPLE_SUPPRESS_DEVELOPER_TOOL_POPUP + GIT_TERMINAL_PROMPT keep the
    // shell from blocking on a CLT-install dialog or a git prompt.
    const output = execSync(`${shellBin} -l -i -c 'echo ${ENV_MARKER} && env'`, {
      encoding: 'utf-8',
      timeout: SHELL_TIMEOUT_MS,
      env: {
        HOME: process.env.HOME,
        USER: process.env.USER,
        SHELL: shellBin,
        TERM: 'xterm-256color',
        TMPDIR: process.env.TMPDIR,
        APPLE_SUPPRESS_DEVELOPER_TOOL_POPUP: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    const envSection = output.split(ENV_MARKER)[1] ?? ''
    let count = 0
    for (const line of envSection.trim().split('\n')) {
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const key = line.slice(0, eq)
      // Never let the login shell override the Electron runtime flags the engine
      // spawn sets explicitly (ELECTRON_RUN_AS_NODE, fuses, …).
      if (key.startsWith('ELECTRON_')) continue
      process.env[key] = line.slice(eq + 1)
      count += 1
    }
    log.info('[shell-env] loaded', {
      vars: count,
      pathEntries: (process.env.PATH ?? '').split(':').length,
    })
  } catch (error) {
    log.warn('[shell-env] login shell failed, prepending common paths as fallback', error)
    prependPaths(fallbackDirs())
  }
}
