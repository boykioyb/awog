// macOS elevation — VPN Manager P1 (design §2.1). Runs openvpn as root via
// `osascript … do shell script "…" with administrator privileges` (the
// SecurityAgent dialog). The TN2065 `& echo $!` idiom backgrounds openvpn and
// makes `do shell script` return immediately with openvpn's real pid.
//
// SECURITY — DOUBLE-ESCAPED INJECTION SINK. The command reaches root through two
// nested layers, each escaped independently:
//   1. /bin/sh:  every token single-quoted (shq) — a `'` inside becomes `'\''`.
//   2. AppleScript string:  `\` and `"` escaped (asStr).
// osascript itself is spawned with an ARG ARRAY (no third shell layer). We NEVER
// pass --daemon (double-fork would make `$!` the pre-fork pid). The argv carries
// no secret (VPN creds are pushed via the management socket), so an error stream
// is safe to surface after firstErrLine().

import { spawn } from 'node:child_process'
import { ElevationCancelled, firstErrLine, type ElevationAdapter } from './adapter.js'

// POSIX single-quote escape: wrap in single quotes; a literal ' becomes '\''.
function shq(v: string): string {
  return `'${v.replace(/'/g, "'\\''")}'`
}

// AppleScript double-quoted string literal: escape backslash then double-quote.
function asStr(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

interface OsascriptResult {
  code: number
  stdout: string
  stderr: string
}

function runOsascript(appleScript: string): Promise<OsascriptResult> {
  return new Promise<OsascriptResult>((resolvePromise, reject) => {
    const child = spawn('osascript', ['-e', appleScript], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) => {
      stdout += d
    })
    child.stderr?.on('data', (d: string) => {
      stderr += d
    })
    child.once('error', reject)
    child.once('close', (code) => resolvePromise({ code: code ?? -1, stdout, stderr }))
  })
}

// The SecurityAgent user-cancel error is `execution error: … (-128)`.
function isCancel(stderr: string): boolean {
  return /-128|User canceled|User cancelled/i.test(stderr)
}

export const macosAdapter: ElevationAdapter = {
  platform: 'darwin',

  async spawnElevated(binary: string, argv: string[]): Promise<{ pid?: number }> {
    const shellCmd = `${shq(binary)} ${argv.map(shq).join(' ')} >/dev/null 2>&1 & echo $!`
    const appleScript = `do shell script ${asStr(shellCmd)} with administrator privileges`
    const { code, stdout, stderr } = await runOsascript(appleScript)
    if (code !== 0) {
      if (isCancel(stderr)) throw new ElevationCancelled('Admin authorization was cancelled')
      throw new Error(`osascript elevation failed: ${firstErrLine(stderr) || `exit ${code}`}`)
    }
    const pid = Number.parseInt(stdout.trim(), 10)
    return Number.isFinite(pid) && pid > 0 ? { pid } : {}
  },

  // mgmt-unreachable fallback: a SECOND admin prompt that kills the root pid.
  async killElevated(pid: number): Promise<void> {
    const shellCmd = `kill ${shq(String(pid))}`
    const appleScript = `do shell script ${asStr(shellCmd)} with administrator privileges`
    const { code, stderr } = await runOsascript(appleScript)
    if (code !== 0 && !/No such process/i.test(stderr)) {
      if (isCancel(stderr)) throw new ElevationCancelled('Admin authorization was cancelled')
      throw new Error(`osascript kill failed: ${firstErrLine(stderr) || `exit ${code}`}`)
    }
  },
}
