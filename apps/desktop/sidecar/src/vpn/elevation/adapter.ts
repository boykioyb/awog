// Elevation adapter contract — VPN Manager P1 (design §2).
//
// One interface; each OS implementation's SOLE job is to launch `binary argv…`
// as root and resolve once the elevation prompt is ANSWERED and openvpn is
// spawning (NOT once connected — readiness is ManagementClient's job). It never
// controls or stops the tunnel.
//
// SECURITY (invariant #8): every implementation spawns its elevation wrapper
// (osascript / pkexec / powershell.exe) with an ARG ARRAY, never a shell string
// at the Node boundary. macOS has one unavoidable inner-shell string (the
// AppleScript), escaped as a dedicated injection sink in macos.ts.

import { macosAdapter } from './macos.js'
import { linuxAdapter } from './linux.js'
import { windowsAdapter } from './windows.js'

// Thrown when the user dismisses the admin/UAC prompt. The manager maps this to a
// clean `down` (not a latched `error`) and never loops.
export class ElevationCancelled extends Error {
  constructor(message = 'Elevation prompt cancelled') {
    super(message)
    this.name = 'ElevationCancelled'
  }
}

export interface ElevationAdapter {
  readonly platform: NodeJS.Platform
  // Resolves after the elevation prompt is ANSWERED and openvpn is spawned.
  // `pid` is the REAL openvpn pid when the OS lets us capture it (macOS `echo $!`),
  // else undefined → the manager reads it from the --writepid file after CONNECTED.
  spawnElevated(binary: string, argv: string[]): Promise<{ pid?: number }>
  // Optional: stop a root pid via a SECOND admin prompt (mgmt-unreachable fallback).
  killElevated?(pid: number): Promise<void>
}

export function selectAdapter(): ElevationAdapter {
  switch (process.platform) {
    case 'darwin':
      return macosAdapter
    case 'linux':
      return linuxAdapter
    case 'win32':
      return windowsAdapter
    default:
      throw new Error(`VPN elevation unsupported on ${process.platform}`)
  }
}

// The `--writepid <path>` argument the openvpn argv always carries (buildOpenvpnArgv).
// Used by adapters (Linux) that need to observe openvpn's own start-up out of band.
export function pidFileFromArgv(argv: string[]): string | undefined {
  const i = argv.indexOf('--writepid')
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}

// First line of an error stream, length-capped and secret-free (the argv carries
// no secret — creds are pushed via the management socket). Shared by adapters.
export function firstErrLine(s: string): string {
  const line = s.split('\n').find((l) => l.trim().length > 0) ?? ''
  return line.trim().slice(0, 200)
}
