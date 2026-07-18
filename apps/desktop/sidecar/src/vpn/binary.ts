// OpenVPN binary detection + allowlist — VPN Manager P1 (ADR 0065 §Decision 7).
//
// SECURITY (invariant #8): the openvpn binary path is NEVER supplied by the UI /
// operator. It is resolved here from a hardcoded per-OS allowlist and verified by
// `realpath` (must be a REGULAR file that is EXECUTABLE) before it is handed to an
// elevation wrapper as arg[0]. A binary that resolves (via symlink) outside the
// allowlist is rejected. Mirrors the graceful-fallback shape of getPty()/keychain
// getModule(): a missing binary disables `vpn.up` (throws "OpenVPN unavailable" +
// install hint) but leaves CRUD alive.

import { access, realpath, stat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'

// Known-good absolute install locations, per OS. Homebrew differs by arch
// (Apple-silicon = /opt/homebrew, Intel = /usr/local); MacPorts = /opt/local.
// (Open question §8 in the design: this list can drift — revisit with the
// registry on Windows / `brew --prefix` on macOS in a later phase.)
const CANDIDATES: Record<string, readonly string[]> = {
  darwin: ['/opt/homebrew/sbin/openvpn', '/usr/local/sbin/openvpn', '/opt/local/sbin/openvpn'],
  linux: ['/usr/sbin/openvpn', '/usr/bin/openvpn'],
  win32: [
    'C:\\Program Files\\OpenVPN\\bin\\openvpn.exe',
    'C:\\Program Files (x86)\\OpenVPN\\bin\\openvpn.exe',
  ],
}

// Trusted, root/admin-owned install PREFIXES the resolved binary must live under.
// A symlink (which the CANDIDATE probe paths often are — Homebrew links
// `/opt/homebrew/sbin/openvpn` → `…/Cellar/openvpn/<ver>/sbin/openvpn`) is allowed
// as long as its realpath stays under one of these standard software prefixes, so
// it can't be redirected to a binary in `/tmp` or a home dir. A non-privileged
// principal cannot plant a binary under these on a normal install.
const ALLOWED_PREFIXES: Record<string, readonly string[]> = {
  darwin: ['/opt/homebrew/', '/usr/local/', '/opt/local/', '/usr/'],
  linux: ['/usr/', '/opt/'],
  win32: ['C:\\Program Files\\', 'C:\\Program Files (x86)\\'],
}

// One valid path is a REGULAR file, EXECUTABLE, whose realpath still sits under a
// trusted install prefix (so a symlink can't redirect us to an attacker-controlled
// binary). Returns the realpath when valid, else null.
async function validateCandidate(
  candidate: string,
  platform: NodeJS.Platform,
): Promise<string | null> {
  try {
    const resolved = await realpath(candidate)
    const info = await stat(resolved)
    if (!info.isFile()) return null
    // On Windows there is no exec bit; existence + .exe is the practical check.
    if (platform !== 'win32') {
      await access(resolved, fsConstants.X_OK)
    }
    const prefixes = ALLOWED_PREFIXES[platform] ?? []
    const target = platform === 'win32' ? resolved.toLowerCase() : resolved
    const ok = prefixes.some((p) => target.startsWith(platform === 'win32' ? p.toLowerCase() : p))
    return ok ? resolved : null
  } catch {
    return null
  }
}

let resolvePromise: Promise<string | null> | null = null

// Lazily detect the openvpn binary once and memoize. Returns the validated
// realpath, or null when no allowlisted binary is installed.
export async function resolveOpenvpnBinary(): Promise<string | null> {
  if (!resolvePromise) {
    resolvePromise = (async () => {
      const platform = process.platform
      const candidates = CANDIDATES[platform]
      if (!candidates) return null
      for (const candidate of candidates) {
        // eslint-disable-next-line no-await-in-loop
        const valid = await validateCandidate(candidate, platform)
        if (valid) return valid
      }
      return null
    })()
  }
  return resolvePromise
}

// Human-readable install hint surfaced by `vpn.up` when the binary is missing.
export function installHint(): string {
  switch (process.platform) {
    case 'darwin':
      return 'Install OpenVPN, e.g. `brew install openvpn`.'
    case 'linux':
      return 'Install OpenVPN from your distro, e.g. `sudo apt install openvpn` or `sudo dnf install openvpn`.'
    case 'win32':
      return 'Install the OpenVPN Community client from https://openvpn.net/community-downloads/.'
    default:
      return 'OpenVPN is not supported on this platform.'
  }
}
