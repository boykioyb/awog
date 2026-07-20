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
import { basename, dirname, isAbsolute } from 'node:path'
import type { VpnAuthMode } from './schema.js'

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
  // Loaders that dlopen a shared object into the ROOT process — NOT gated by
  // `--script-security` (infosec F1b). `pkcs11-providers` + `engine` load libraries;
  // the rest are arbitrary root file-write / clobber primitives.
  'pkcs11-providers',
  'engine',
  'status',
  'ifconfig-pool-persist',
  'tls-export-cert',
])

// Inline `<tag>…</tag>` blocks whose body is opaque PEM / key material (NOT
// directives) — their bodies are skipped. Any OTHER angle-bracket block (e.g.
// `<connection>`) IS parsed by openvpn as directives, so we parse it too (infosec
// F6) rather than skipping it blind.
const OPAQUE_BLOCKS = new Set([
  'ca',
  'cert',
  'key',
  'tls-auth',
  'tls-crypt',
  'tls-crypt-v2',
  'dh',
  'pkcs12',
  'secret',
  'extra-certs',
  'http-proxy-user-pass',
  'pkcs11-id',
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

interface Directive {
  name: string // normalized: leading `--` stripped, lowercased
  rest: string
  raw: string // the raw first whitespace-token, verbatim (for the evasion check)
}

// Split an .ovpn into directive lines, skipping comments (`#`/`;`) and the bodies
// of OPAQUE inline `<tag>…</tag>` blocks (cert/key PEM must not be parsed as
// directives). Structural blocks like `<connection>` are NOT skipped — openvpn
// parses their inner lines as directives, so we do too (infosec F6).
function directiveLines(text: string): Directive[] {
  const out: Directive[] = []
  let opaqueTag: string | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (opaqueTag) {
      if (line.toLowerCase() === `</${opaqueTag}>`) opaqueTag = null
      continue
    }
    if (line.startsWith('#') || line.startsWith(';')) continue
    const openBlock = /^<([a-z0-9-]+)>$/i.exec(line)
    if (openBlock) {
      // Opaque (PEM) block → skip its body. Structural block (e.g. <connection>) →
      // just skip the marker line and keep parsing its inner directives.
      const tag = openBlock[1].toLowerCase()
      if (OPAQUE_BLOCKS.has(tag)) opaqueTag = tag
      continue
    }
    if (/^<\/[a-z0-9-]+>$/i.test(line)) continue // stray close marker (e.g. </connection>)
    // First whitespace-delimited token = directive name; keep the remainder for
    // directives whose value we inspect (script-security / dev / dev-type). Strip a
    // leading `--` so a `--iproute`/`--plugin` form can't slip past the denylist.
    const spaceIdx = line.search(/\s/)
    const raw = spaceIdx === -1 ? line : line.slice(0, spaceIdx)
    const name = raw.replace(/^--/, '').toLowerCase()
    const rest = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1).trim()
    out.push({ name, rest, raw })
  }
  return out
}

function assertDirectivesSafe(directives: Directive[]): void {
  for (const { name, rest, raw } of directives) {
    // EVASION GUARD (infosec F1a). openvpn's parser strips `"`/`'` quoting and `\`
    // escapes from EVERY token including the directive name, so `"plugin"` acts as
    // `plugin` while dodging a string denylist. A legitimate directive NAME never
    // contains a quote or backslash — reject any that does, before matching.
    if (/["'\\]/.test(raw)) {
      throw new OvpnValidationError('.ovpn has a quoted or escaped directive name (not allowed)')
    }
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
): Promise<{ configPath: string; dir: string; content: string }> {
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

  // Return the validated bytes so the caller can spawn openvpn against a private
  // copy (infosec F2) — validated-content == executed-content, no re-read race.
  return { configPath: real, dir: dirname(real), content: text }
}

// A NEW-profile draft derived from a .ovpn — VPN Manager P4 import (dry-run). Holds
// ONLY non-secret metadata; never any key/cert material.
export interface OvpnDraft {
  name: string
  configPath: string
  authMode: VpnAuthMode
}

// Filename stem, e.g. "/vpn/office.ovpn" → "office". Used as the draft display name.
function stemFromPath(p: string): string {
  const base = basename(p)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

// `auth-user-pass` WITHOUT a file argument means openvpn will PROMPT for user/pass,
// which we push via the management interface → authMode 'user-pass'. With a file
// argument the creds come from that file, and with no such directive the profile
// authenticates via cert/config → authMode 'none' either way.
function detectAuthMode(directives: { name: string; rest: string }[]): VpnAuthMode {
  for (const { name, rest } of directives) {
    if (name === 'auth-user-pass' && rest.length === 0) return 'user-pass'
  }
  return 'none'
}

// openvpn 2.6+ refuses any negotiated data cipher not in `--data-ciphers` (default is
// AEAD-only: AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305). Legacy servers still push a CBC
// cipher via the deprecated `cipher` directive, which 2.7 no longer folds into the allow
// list — so the tunnel dies with "negotiated cipher not allowed … not in DEFAULT" right
// after ASSIGN_IP. When a config declares such a legacy `cipher` (and no explicit
// `data-ciphers` of its own), return a list that PREFERS the AEAD defaults but also
// ALLOWS the declared legacy cipher — matching OpenVPN Connect / openvpn 2.5. null when
// no compat is needed (modern cipher, or the config already sets data-ciphers).
const AEAD_DATA_CIPHERS = 'AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305'
const MODERN_CIPHERS = new Set(['AES-256-GCM', 'AES-128-GCM', 'CHACHA20-POLY1305'])

export function legacyDataCiphersCompat(content: string): string | null {
  let legacy: string | null = null
  for (const { name, rest } of directiveLines(content)) {
    if (name === 'data-ciphers') return null // the config controls the list explicitly
    if (name === 'cipher' && rest) {
      const c = (rest.split(/\s+/)[0] ?? '').toUpperCase()
      if (c && !MODERN_CIPHERS.has(c)) legacy = c
    }
  }
  return legacy ? `${AEAD_DATA_CIPHERS}:${legacy}` : null
}

// Directives through which a config declares its OWN dead-peer / keepalive policy.
// `keepalive N M` expands to `--ping N --ping-restart M`; `--ping-exit` opts into
// exit-on-timeout on purpose. If any is present we must NOT inject our own default.
const KEEPALIVE_DIRECTIVES = new Set(['keepalive', 'ping', 'ping-restart', 'ping-exit'])

// True when the config defines NO keepalive/ping directive at all. Such a config has
// no way to notice a silently-dropped link: the tunnel hangs `up` on a dead socket,
// or the root process later exits — which forces a full re-elevation (another admin
// prompt). The caller then injects a conservative `--ping`/`--ping-restart` so openvpn
// detects the drop and restarts IN-PROCESS (SIGUSR1, same root process, no re-prompt).
// Gated on the config so an explicit keepalive policy is never overridden.
export function needsPingDefault(content: string): boolean {
  for (const { name } of directiveLines(content)) {
    if (KEEPALIVE_DIRECTIVES.has(name)) return false
  }
  return true
}

// Dry-run parse of a .ovpn into a NEW-profile draft (VPN Manager P4). Runs the full
// validateOvpnConfig root-RCE guard first (throws OvpnValidationError on reject), so a
// hostile config can never seed a profile. Then derives non-secret metadata only:
// name (filename stem), the canonical realpath, and authMode — from the SAME bytes
// validateOvpnConfig already read (no second read). NEVER returns key/cert material.
export async function deriveOvpnDraft(path: string): Promise<OvpnDraft> {
  const { configPath, content } = await validateOvpnConfig(path)
  return {
    name: stemFromPath(configPath),
    configPath,
    authMode: detectAuthMode(directiveLines(content)),
  }
}
