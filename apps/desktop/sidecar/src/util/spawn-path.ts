// Augment the sidecar's PATH so child processes (MCP `npx`, git, node-pty)
// resolve the same binaries the user's terminal does.
//
// WHY: when the desktop app is launched from Finder / Dock / Spotlight (not a
// terminal), macOS gives the process a minimal PATH (`/usr/bin:/bin:/usr/sbin:
// /sbin`) that omits Homebrew (`/opt/homebrew/bin`), `/usr/local/bin`, and any
// node-version-manager bin (nvm/fnm). The MCP bridge then hits `spawn npx
// ENOENT` and silently registers zero tools — the model is told the server
// exists, can't reach it, and (observed) fabricates results. Fixing PATH once
// at boot repairs every downstream spawn because they all forward
// `process.env.PATH`.
//
// Strategy: (1) best-effort read the login shell's PATH (captures nvm/fnm/
// Homebrew exactly as the terminal sees them), (2) union a static floor of
// well-known dirs. Existing entries keep priority; we only ADD missing dirs.

import { execFileSync } from 'node:child_process'
import { delimiter } from 'node:path'
import { log } from './logger.js'

// Static floor — the common locations a GUI launch tends to drop. Unioned after
// the probed shell PATH so they act as a fallback, never an override.
const WELL_KNOWN_DIRS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/local/sbin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
] as const

// Markers bracket the PATH in the probe output so a noisy rc file (prompt
// frameworks, `echo` in .zshrc) can't corrupt the parsed value.
const MARK_START = '__AWOG_PATH_START__'
const MARK_END = '__AWOG_PATH_END__'

// Spawn the user's login+interactive shell and read its resolved PATH. Fixed
// command string (no user input → L3 trusted). Best-effort: a 2s timeout and a
// swallowed error keep boot fast and robust if the shell hangs or is absent.
function probeLoginShellPath(): string | null {
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const out = execFileSync(shell, ['-ilc', `printf '%s%s%s' '${MARK_START}' "$PATH" '${MARK_END}'`], {
      timeout: 2000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const match = out.match(/__AWOG_PATH_START__([\s\S]*?)__AWOG_PATH_END__/)
    const value = match?.[1]?.trim()
    return value && value.includes('/') ? value : null
  } catch (err) {
    log.warn('spawn-path: login-shell PATH probe failed', {
      shell,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// Idempotent: mutates process.env.PATH in place, adding any missing dirs while
// preserving the order/priority of what's already there. No-op on Windows,
// where GUI launches inherit the full PATH from the registry.
export function ensureUserPath(): void {
  if (process.platform === 'win32') return

  const parts = new Set((process.env.PATH ?? '').split(delimiter).filter(Boolean))
  const before = parts.size

  const shellPath = probeLoginShellPath()
  if (shellPath) {
    for (const dir of shellPath.split(delimiter)) {
      if (dir) parts.add(dir)
    }
  }
  for (const dir of WELL_KNOWN_DIRS) parts.add(dir)

  process.env.PATH = [...parts].join(delimiter)
  if (parts.size !== before) {
    log.info('spawn-path: augmented PATH for child processes', {
      added: parts.size - before,
      fromLoginShell: shellPath !== null,
    })
  }
}
