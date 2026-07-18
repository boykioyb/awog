// Windows elevation — VPN Manager P1 (design §2.3). Runs openvpn elevated via
// `Start-Process -Verb RunAs` (one UAC per bring-up — the same contract as
// mac/Linux). `child_process.spawn('openvpn.exe')` directly fails with
// ERROR_ELEVATION_REQUIRED (740) and there is no spawn flag for UAC, so we shell
// out to PowerShell. "prompt-once-at-setup, silent forever" needs the OpenVPN
// Interactive Service (named pipe) — that is P2.
//
// SECURITY (invariant #8): powershell.exe is spawned with an ARG ARRAY. The one
// PowerShell string surface (the `-Command`) single-quote-escapes the binary path
// and every argv token (a literal ' becomes ''), so a crafted arg cannot break
// out of the string. The elevated child detaches (different token) → Node gets no
// handle; the manager tracks lifecycle via the management socket + --writepid.

import { spawn } from 'node:child_process'
import { ElevationCancelled, firstErrLine, type ElevationAdapter } from './adapter.js'

// PowerShell single-quoted string literal: a literal ' is doubled.
function psq(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}

interface PsResult {
  code: number
  stderr: string
}

function runPowershell(command: string): Promise<PsResult> {
  return new Promise<PsResult>((resolvePromise, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (d: string) => {
      stderr += d
    })
    child.once('error', reject)
    child.once('close', (code) => resolvePromise({ code: code ?? -1, stderr }))
  })
}

// UAC decline surfaces as a terminating error mentioning cancellation.
function isCancel(stderr: string): boolean {
  return /canceled by the user|cancelled by the user/i.test(stderr)
}

export const windowsAdapter: ElevationAdapter = {
  platform: 'win32',

  async spawnElevated(binary: string, argv: string[]): Promise<{ pid?: number }> {
    const psArgs = argv.map(psq).join(',')
    // -ArgumentList @() must be non-empty; our argv always carries flags.
    const command =
      `Start-Process -FilePath ${psq(binary)} -Verb RunAs -WindowStyle Hidden` +
      (psArgs ? ` -ArgumentList @(${psArgs})` : '')
    const { code, stderr } = await runPowershell(command)
    if (code !== 0) {
      if (isCancel(stderr)) throw new ElevationCancelled('UAC elevation was declined')
      throw new Error(`RunAs elevation failed: ${firstErrLine(stderr) || `exit ${code}`}`)
    }
    // The elevated process detaches across the token boundary — no pid here. The
    // manager backfills it from the --writepid file after CONNECTED.
    return {}
  },
}
