// .ovpn config validation — VPN Manager P1 (ADR 0065 §Decision 7, design §5 #8).
//
// SECURITY — THIS FILE IS A ROOT-RCE GUARD. The validated .ovpn is handed to an
// openvpn process that runs as ROOT. A single missed directive here is arbitrary
// root code execution, so validation is fail-closed and layered:
//
//   1. Path sanitize: absolute, realpath (defeat symlink swap), exists, readable,
//      strict charset (no quotes/newline/control/shell-meta) — the path becomes
//      part of the macOS AppleScript inner-shell string + the Windows PS string.
//   2. Directive DENYLIST: reject every directive that can run a script or a
//      binary as root (up/down/route-*/ipchange/tls-verify/client-*/learn-address/
//      auth-user-pass-verify/plugin), any `script-security > 1`, and any
//      `management*` directive (so the profile can't hijack our control socket).
//   3. Require tun/utun (reject TAP): TAP needs a bridged L2 device we don't set
//      up, and its driver surface is broader.
//
// (Open question §4 in the design: a denylist must stay ahead of new root-exec
// directives; infosec may convert this to an allowlist of known-safe directives.)

import { access, readFile, realpath, stat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'

// Directives that can execute a script or load a binary as root, or that would
// let the profile override our management socket. Matched case-insensitively on
// the directive name (first whitespace-delimited token of a line).
const DENY_DIRECTIVES = new Set([
  'up',
  'down',
  'route-up',
  'route-pre-down',
  'ipchange',
  'tls-verify',
  'tls-crypt-v2-verify',
  'client-connect',
  'client-disconnect',
  'learn-address',
  'auth-user-pass-verify',
  'plugin',
  // `iproute` sets the command openvpn runs to configure routes — arbitrary root
  // exec that is NOT gated by `--script-security 1` (unlike the up/down scripts).
  'iproute',
  // `config` pulls in ANOTHER config file inline; the nested file would bypass this
  // single-file validation (could smuggle plugin/iproute). A managed client .ovpn
  // never needs nested includes — inline it instead.
  'config',
])

export class OvpnValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OvpnValidationError'
  }
}

// Strict path charset. On POSIX the design mandates `^/[A-Za-z0-9._/-]+\.ovpn$`
// (no spaces/quotes/backslash/newline) — the path is a /bin/sh + AppleScript sink
// on macOS. On Windows a drive letter + backslash are unavoidable, so allow those
// plus spaces (common in `C:\Users\…`) while still rejecting every shell/PS
// metacharacter (quotes, `$`, backtick, ; & | < > % ^, control chars).
const POSIX_PATH_RE = /^\/[A-Za-z0-9._/-]+\.ovpn$/
const WIN_PATH_RE = /^[A-Za-z]:\\[A-Za-z0-9._\\ -]+\.ovpn$/i

function assertPathCharset(p: string): void {
  const re = process.platform === 'win32' ? WIN_PATH_RE : POSIX_PATH_RE
  if (!re.test(p)) {
    throw new OvpnValidationError(
      'config path contains disallowed characters or is not a .ovpn file',
    )
  }
}

// Split an .ovpn into directive lines, skipping comments (`#`/`;`) and the bodies
// of inline `<tag>…</tag>` blocks (cert/key PEM must not be parsed as directives).
function directiveLines(text: string): { name: string; rest: string }[] {
  const out: { name: string; rest: string }[] = []
  let blockTag: string | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (blockTag) {
      if (line.toLowerCase() === `</${blockTag}>`) blockTag = null
      continue
    }
    if (line.startsWith('#') || line.startsWith(';')) continue
    const openBlock = /^<([a-z0-9-]+)>$/i.exec(line)
    if (openBlock) {
      blockTag = openBlock[1].toLowerCase()
      continue
    }
    // First whitespace-delimited token = directive name; keep the remainder for
    // directives whose value we inspect (script-security / dev / dev-type). Strip a
    // leading `--` so a `--iproute`/`--plugin` form can't slip past the denylist
    // (openvpn tolerates the dashed form in a config file).
    const spaceIdx = line.search(/\s/)
    const rawName = spaceIdx === -1 ? line : line.slice(0, spaceIdx)
    const name = rawName.replace(/^--/, '').toLowerCase()
    const rest = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1).trim()
    out.push({ name, rest })
  }
  return out
}

function assertDirectivesSafe(directives: { name: string; rest: string }[]): void {
  for (const { name, rest } of directives) {
    if (DENY_DIRECTIVES.has(name)) {
      throw new OvpnValidationError(`.ovpn contains a disallowed directive: ${name}`)
    }
    // Any `management*` directive would let the profile override our loopback
    // control socket (and thus its random per-run password gate).
    if (name === 'management' || name.startsWith('management-')) {
      throw new OvpnValidationError(`.ovpn may not set a management directive: ${name}`)
    }
    if (name === 'script-security') {
      const level = Number.parseInt(rest.split(/\s+/)[0] ?? '', 10)
      if (Number.isFinite(level) && level > 1) {
        throw new OvpnValidationError(`.ovpn requests script-security ${level} (> 1)`)
      }
    }
    // Reject TAP (L2). `dev tapN` or `dev-type tap`.
    if (name === 'dev') {
      const devName = rest.split(/\s+/)[0]?.toLowerCase() ?? ''
      if (devName.startsWith('tap')) {
        throw new OvpnValidationError('.ovpn uses a TAP device; only tun/utun is supported')
      }
    }
    if (name === 'dev-type') {
      const devType = rest.split(/\s+/)[0]?.toLowerCase() ?? ''
      if (devType === 'tap') {
        throw new OvpnValidationError('.ovpn uses dev-type tap; only tun is supported')
      }
    }
  }
}

// Validate + return the canonical (realpath) config path and its directory. The
// caller passes `configPath` from the profile — an L1-untrusted string. Throws
// OvpnValidationError with a clear, secret-free reason on any failure.
export async function validateOvpnConfig(
  path: string,
): Promise<{ configPath: string; dir: string }> {
  if (!isAbsolute(path)) {
    throw new OvpnValidationError('config path must be absolute')
  }
  let real: string
  try {
    real = await realpath(path)
  } catch {
    throw new OvpnValidationError('config file not found')
  }
  // Charset is validated on the CANONICAL path — that is the string that lands in
  // the elevation shell/PS layer, so a symlink can't smuggle a hostile name.
  assertPathCharset(real)

  const info = await stat(real)
  if (!info.isFile()) {
    throw new OvpnValidationError('config path is not a regular file')
  }
  await access(real, fsConstants.R_OK)

  // Cap the read — a real .ovpn (with inline certs) is a few KB; anything huge is
  // not a config we should parse as root.
  if (info.size > 1_000_000) {
    throw new OvpnValidationError('config file is unexpectedly large')
  }
  const text = await readFile(real, 'utf8')
  assertDirectivesSafe(directiveLines(text))

  return { configPath: real, dir: dirname(real) }
}
