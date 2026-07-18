// Linux elevation — VPN Manager P1 (design §2.2). Runs openvpn as root via
// `pkexec` so the session polkit agent shows a GUI password dialog from a
// windowless Electron/AppImage. No custom .policy file (a persistent privileged
// component is forbidden until P2) → the default action prompts every bring-up.
//
// pkexec is spawned with an ARG ARRAY (invariant #8). Resolution signal: unlike
// macOS `do shell script`, pkexec stays attached to (or reparents) openvpn, so we
// cannot wait for `close` to mean "prompt answered" — a held openvpn never exits.
// Instead we watch openvpn's --writepid file: it appears only AFTER polkit auth
// succeeds and openvpn starts init → that is our "prompt answered" edge. An early
// pkexec exit means the dialog was dismissed (126) / denied or no agent (127) /
// openvpn itself failed (other non-zero).
//
// Gotcha (design §2.2): pkexec sanitizes env + runs in ROOT's home, so relative
// ca/cert/key in the .ovpn break — buildOpenvpnArgv always passes absolute
// --config + --cd <ovpn-dir> to compensate.

import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { ElevationCancelled, pidFileFromArgv, firstErrLine, type ElevationAdapter } from './adapter.js'

// Upper bound on how long we wait for the human to answer the polkit dialog +
// openvpn to write its pidfile. The manager's own connect timeout is shorter but
// only arms after this resolves, so give the prompt a generous window.
const AUTH_WAIT_MS = 120_000
const PIDFILE_POLL_MS = 300

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

export const linuxAdapter: ElevationAdapter = {
  platform: 'linux',

  spawnElevated(binary: string, argv: string[]): Promise<{ pid?: number }> {
    const pidFile = pidFileFromArgv(argv)
    return new Promise<{ pid?: number }>((resolvePromise, reject) => {
      const child = spawn('pkexec', [binary, ...argv], {
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let settled = false
      let stderr = ''
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (d: string) => {
        stderr += d
      })

      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearInterval(poll)
        fn()
      }

      child.once('error', (err) => finish(() => reject(err)))
      child.once('exit', (code) => {
        // 126 = dialog dismissed; 127 = denied / no polkit agent; other non-zero =
        // openvpn's own early failure. Code 0 / null may just be pkexec detaching
        // after a successful launch → let the pidfile poll decide (don't reject).
        if (code === 126) {
          finish(() => reject(new ElevationCancelled('Authentication dialog was dismissed')))
        } else if (code === 127) {
          finish(() =>
            reject(
              new Error(
                'pkexec: authorization failed — ensure a polkit authentication agent is running',
              ),
            ),
          )
        } else if (typeof code === 'number' && code !== 0) {
          finish(() =>
            reject(new Error(`openvpn exited during startup: ${firstErrLine(stderr) || `code ${code}`}`)),
          )
        }
      })

      // Poll for the pidfile = auth answered + openvpn running. pkexec keeps the
      // openvpn pid opaque to us, so the manager reads the pid from this same file.
      const startedAt = Date.now()
      const poll = setInterval(() => {
        void (async () => {
          if (settled) return
          if (await fileExists(pidFile ?? '')) {
            finish(() => resolvePromise({}))
          } else if (Date.now() - startedAt > AUTH_WAIT_MS) {
            finish(() => reject(new Error('timed out waiting for the admin prompt / openvpn to start')))
          }
        })()
      }, PIDFILE_POLL_MS)
      poll.unref?.()
    })
  },
}
