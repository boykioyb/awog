// openvpn launch helpers — VPN Manager P1 (design §3.1).
//
// Builds the openvpn argv (arg ARRAY only — invariant #8, no shell string), the
// per-profile runtime file paths under ~/.awog/vpn-run/<id>/, a loopback free
// port for the management socket, and the atomic 0600 write of the random
// per-run management password file.
//
// SECURITY: the management socket binds 127.0.0.1 ONLY + a random high port +
// the random pw-file below (invariant #6). We NEVER pass --daemon (openvpn would
// double-fork and the macOS `& echo $!` pid capture would return the pre-fork
// pid). We ALWAYS pass --script-security 1 so no .ovpn up/down/route script runs.

import net from 'node:net'
import { chmod, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'

export interface VpnRuntimePaths {
  dir: string
  pwFile: string
  pidFile: string
  logFile: string
  configFile: string
}

// Per-profile runtime directory + file paths. `id` is sanitized (schema VPN_ID_RE
// already forbids separators, but guard again at the filesystem boundary).
export function runtimePaths(id: string): VpnRuntimePaths {
  const dir = join(awogHome(), 'vpn-run', sanitizeChild(id))
  return {
    dir,
    pwFile: join(dir, 'mgmt.pw'),
    pidFile: join(dir, 'openvpn.pid'),
    logFile: join(dir, 'openvpn.log'),
    // Sidecar-private copy of the VALIDATED .ovpn — openvpn reads THIS (infosec F2),
    // so the bytes root parses are exactly the bytes we validated (no swap window).
    configFile: join(dir, 'config.ovpn'),
  }
}

// Atomically write the validated .ovpn bytes to the sidecar-private config file
// (mode 0600 in the 0700 runtime dir). Closes the validate→spawn content-swap race:
// openvpn reads this file, not the user-writable original.
export async function writePrivateConfig(configFile: string, content: string): Promise<void> {
  const tmp = `${configFile}.tmp.${process.pid}`
  await writeFile(tmp, content, { encoding: 'utf8', mode: 0o600 })
  await chmod(tmp, 0o600)
  await rename(tmp, configFile)
}

export interface OpenvpnArgvOptions {
  configPath: string // the sidecar-private validated copy (see writePrivateConfig)
  ovpnDir: string // the ORIGINAL config dir — for --cd so relative ca/cert/key resolve
  port: number
  pwFile: string
  pidFile: string
  logFile: string
}

// Assemble the openvpn argv (design §3.1). Order matters: --config is pulled in
// at its position, so every hardening flag AFTER it (script-security, dev) wins
// over anything the file tried to set.
export function buildOpenvpnArgv(opts: OpenvpnArgvOptions): string[] {
  const argv = [
    '--config',
    opts.configPath,
    '--cd',
    opts.ovpnDir,
    '--management',
    '127.0.0.1',
    String(opts.port),
    opts.pwFile,
    '--management-hold', // hibernate until we connect + `hold release`
    '--management-query-passwords', // push creds over the socket, never a file
    '--auth-nocache', // don't cache creds (we keep answering re-prompts)
    '--auth-retry',
    'interact', // treat auth-abort as terminal, not a fork/exit
    '--script-security',
    '1', // deny .ovpn up/down/route scripts (root RCE guard)
    '--writepid',
    opts.pidFile, // recover the real pid (mac echo $! is primary)
    '--log',
    opts.logFile,
    '--verb',
    '3',
  ]

  // Per-platform device. NEVER --daemon (breaks macOS `& echo $!` pid capture).
  if (process.platform === 'darwin') {
    argv.push('--dev', 'utun')
  } else if (process.platform === 'win32') {
    argv.push('--windows-driver', 'wintun')
  }
  // Linux: built-in tun (config `dev`/default) — no extra flag.

  return argv
}

// Ask the OS for a free loopback port, then release it and hand the number to
// openvpn. TOCTOU race noted in design §5 (open question §5): if openvpn can't
// bind it the connect retry surfaces a clear error and the user retries. Bind
// 127.0.0.1 explicitly so we never probe a public interface.
export function bindTestFreePort(): Promise<number> {
  return new Promise<number>((resolvePort, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        server.close(() => reject(new Error('failed to allocate a management port')))
        return
      }
      const { port } = addr
      server.close(() => resolvePort(port))
    })
  })
}

// Atomically write the random management password to `pwFile` with mode 0600.
// The caller has already created the parent dir with mode 0700. The password is
// a short-lived socket secret (unlinked right after CONNECTED) — it is NOT a VPN
// credential and NEVER leaves the sidecar.
export async function writePwFile(pwFile: string, password: string): Promise<void> {
  const tmp = `${pwFile}.tmp.${process.pid}`
  await writeFile(tmp, password, { encoding: 'utf8', mode: 0o600 })
  await chmod(tmp, 0o600)
  await rename(tmp, pwFile)
}
