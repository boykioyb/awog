// RTK (Rust Token Killer) integration for the Bash tool (ADR 0031).
//
// RTK is a CLI proxy that compresses verbose command output (git/test/lint/build/
// ls/grep…) by 60-90% before it reaches the model context. The binary is BUNDLED
// with the app (electron extraResources) and its absolute path is handed to the
// engine via AWOG_RTK_BIN at spawn time (electron/src/engine.ts) — we never probe
// PATH or rely on a user install.
//
// When enabled + the binary probes OK, the Bash tool prepends `<rtkBin> ` to the
// command, so `git status` runs as `<rtkBin> git status`. RTK runs the underlying
// tool, compresses its output, and PRESERVES the original exit code; unsupported
// commands pass through unchanged. Graceful fallback: a missing/broken binary or a
// disabled toggle => the command runs raw, exactly as before.
//
// Scope: this is wired ONLY into the Bash tool. It must never touch git/runner.ts
// (that output is parsed into structured records, not sent to the model — RTK would
// corrupt the parser) nor the interactive node-pty terminal (its output streams to
// the UI for the user, not into the model context).

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'

// Absolute path to the bundled binary, injected by the Electron main at engine
// spawn. Empty in non-Electron contexts (e.g. dev sidecar without the shell) =>
// treated as unavailable => graceful fallback.
const RTK_BIN = process.env.AWOG_RTK_BIN ?? ''

const PROBE_TIMEOUT_MS = 5_000

type RtkProbe = { available: boolean; version?: string }

// Default ON (the binary is always bundled). The UI pushes the user's persisted
// toggle via the `settings.set-rtk` RPC shortly after the sidecar boots; until
// then the auto-on default applies (matches the bundled-binary contract).
let enabled = true

// Memoized binary probe — `<bin> --version` is run at most once per engine
// lifetime. Mirrors the version-probe pattern in methods/git.check-installed.ts.
let probePromise: Promise<RtkProbe> | null = null

function probeRtk(): Promise<RtkProbe> {
  if (probePromise) return probePromise
  probePromise = new Promise<RtkProbe>((resolve) => {
    if (!RTK_BIN || !existsSync(RTK_BIN)) {
      resolve({ available: false })
      return
    }
    execFile(RTK_BIN, ['--version'], { timeout: PROBE_TIMEOUT_MS }, (err, stdout) => {
      if (err) {
        resolve({ available: false })
        return
      }
      const match = /(\d+\.\d+\.\d+)/.exec(stdout)
      resolve(match ? { available: true, version: match[1] } : { available: true })
    })
  })
  return probePromise
}

// POSIX single-quote a path for `sh -c`. The bundled path is trusted (constructed
// by the Electron main, not UI/model input), but it can contain spaces, so quote
// it. Single quotes also keep Windows backslashes literal under the git-bash `sh`
// the Bash tool already assumes.
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

// Toggle RTK on/off at runtime (called by the settings.set-rtk RPC). No restart
// needed — the next Bash command picks up the new value.
export function setRtkEnabled(value: boolean): void {
  enabled = value
}

// Current state for the settings.set-rtk RPC response so the UI can show whether
// the bundled binary loaded on this platform and which version.
export async function getRtkStatus(): Promise<{ enabled: boolean; available: boolean; version?: string }> {
  const probe = await probeRtk()
  return probe.version !== undefined
    ? { enabled, available: probe.available, version: probe.version }
    : { enabled, available: probe.available }
}

// Rewrite a Bash command to run through RTK when enabled + available. Returns the
// command unchanged on any fallback condition.
export async function wrapCommand(command: string): Promise<string> {
  if (!enabled) return command
  const probe = await probeRtk()
  if (!probe.available) return command
  return `${shQuote(RTK_BIN)} ${command}`
}
