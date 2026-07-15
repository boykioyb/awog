// SSH host-key verification (TOFU) — ADR 0063 P2. SECURITY-CRITICAL.
//
// We do NOT auto-accept unknown host keys. The manager's hostVerifier computes
// the SHA256 fingerprint of the presented key and checks it against the user's
// ~/.ssh/known_hosts via `verifyHostKey`:
//   - 'match'   → the exact key is already trusted → connect.
//   - 'unknown' → no entry for this host+keytype → PARK + prompt the UI.
//   - 'changed' → an entry exists for host+keytype but the key differs → PARK +
//                 prompt (possible MITM — the UI must warn loudly).
//
// A parked verification holds ssh2's `verify(valid)` callback in `pending`,
// keyed by the connection id, until the UI answers via `ssh.confirmHostKey`
// (→ resolveHostKey). Accept+remember appends a plaintext entry (append-only,
// never rewrites existing lines). Reject fails the handshake cleanly.
//
// Hashed known_hosts entries (`|1|salt|hash`, HashKnownHosts — the Debian/Ubuntu
// default) ARE matched via HMAC-SHA1 (F2), so a swapped key is detected as
// 'changed' there too rather than downgraded to 'unknown'. Marker lines
// (`@cert-authority` / `@revoked`) are still not honored (v1) — a host with only
// such an entry prompts as 'unknown'. Appends are plaintext + append-only, with
// host/keyType charset-guarded so a crafted host can't inject a second line (F1).

import { createHash, createHmac } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { log } from '../util/logger.js'

export type HostKeyStatus = 'match' | 'unknown' | 'changed'

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function knownHostsFile(): string {
  return join(homedir(), '.ssh', 'known_hosts')
}

// OpenSSH stores the default port (22) as a bare hostname and any other port as
// the bracketed `[host]:port` form. Hostnames are case-insensitive.
function hostToken(host: string, port: number): string {
  const h = host.toLowerCase()
  return port === 22 ? h : `[${h}]:${port}`
}

interface KnownHostEntry {
  keyType: string
  keyBase64: string
  // A plaintext host list (lowercased) OR a hashed matcher (|1|salt|mac).
  hosts?: string[]
  hashed?: { salt: Buffer; mac: string }
}

function parseKnownHosts(content: string): KnownHostEntry[] {
  const out: KnownHostEntry[] = []
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    // Marker lines (@cert-authority / @revoked) are not handled in v1.
    if (line.startsWith('@')) continue
    const parts = line.split(/\s+/)
    if (parts.length < 3) continue
    const hostField = parts[0]
    const keyType = parts[1]
    const keyBase64 = parts[2]
    // Hashed entry `|1|base64(salt)|base64(HMAC-SHA1(salt, hostToken))` (F2):
    // keep it so a changed key on a HashKnownHosts client (Debian/Ubuntu default)
    // is still detected as 'changed' rather than silently downgraded to 'unknown'.
    if (hostField.startsWith('|')) {
      const m = /^\|1\|([^|]+)\|(.+)$/.exec(hostField)
      if (!m) continue
      out.push({ keyType, keyBase64, hashed: { salt: Buffer.from(m[1], 'base64'), mac: m[2] } })
      continue
    }
    const hosts = hostField.split(',').map((h) => h.toLowerCase())
    out.push({ keyType, keyBase64, hosts })
  }
  return out
}

// Does an entry cover `token`? Plaintext = list membership; hashed = HMAC-SHA1.
function entryMatches(entry: KnownHostEntry, token: string): boolean {
  if (entry.hosts) return entry.hosts.includes(token)
  if (entry.hashed) {
    const mac = createHmac('sha1', entry.hashed.salt).update(token).digest('base64')
    return mac === entry.hashed.mac
  }
  return false
}

async function readKnownHosts(): Promise<KnownHostEntry[]> {
  try {
    const content = await readFile(knownHostsFile(), 'utf8')
    return parseKnownHosts(content)
  } catch (err) {
    if (isMissing(err)) return []
    // A real read error (e.g. EACCES) must fail closed at the caller.
    throw err
  }
}

// OpenSSH-style SHA256 fingerprint: `SHA256:` + base64(sha256(blob)) with the
// trailing `=` padding stripped (matches `ssh-keygen -lf` output).
export function sha256Fingerprint(keyBlob: Buffer): string {
  const digest = createHash('sha256').update(keyBlob).digest('base64')
  return `SHA256:${digest.replace(/=+$/, '')}`
}

// The SSH public-key wire format begins with a length-prefixed string naming the
// key type (e.g. "ssh-ed25519", "ecdsa-sha2-nistp256"). Parse it defensively.
export function keyTypeFromBlob(keyBlob: Buffer): string {
  if (keyBlob.length < 4) return 'unknown'
  const len = keyBlob.readUInt32BE(0)
  if (len <= 0 || len > 64 || keyBlob.length < 4 + len) return 'unknown'
  return keyBlob.toString('ascii', 4, 4 + len)
}

// Compare the presented key (base64 of the raw wire blob) against known_hosts.
export async function verifyHostKey(
  host: string,
  port: number,
  keyType: string,
  keyBase64: string,
): Promise<HostKeyStatus> {
  const entries = await readKnownHosts()
  const token = hostToken(host, port)
  let sawSameType = false
  for (const entry of entries) {
    if (!entryMatches(entry, token)) continue
    if (entry.keyType !== keyType) continue
    sawSameType = true
    if (entry.keyBase64 === keyBase64) return 'match'
  }
  // A stored key of the SAME type that didn't match → the key changed.
  return sawSameType ? 'changed' : 'unknown'
}

// Append a trusted entry. Append-only: existing lines are never rewritten.
export async function appendKnownHost(
  host: string,
  port: number,
  keyType: string,
  keyBase64: string,
): Promise<void> {
  // Defense-at-sink (F1): never let a host/keyType carrying whitespace or a
  // known_hosts structural char (`,` `@` `#` `|`) reach the file — that would
  // inject a second line (e.g. a `@cert-authority *` trusting an attacker key).
  // `host` is already charset-validated by the schema; `keyType` comes from the
  // remote wire blob, so re-check both here. `keyBase64` is base64-safe.
  const UNSAFE = /[\s,@#|]/
  if (UNSAFE.test(host) || UNSAFE.test(keyType)) {
    throw new Error('refusing to append known_hosts entry with unsafe host/keyType')
  }
  const dir = join(homedir(), '.ssh')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = knownHostsFile()
  const line = `${hostToken(host, port)} ${keyType} ${keyBase64}\n`
  // Guard against concatenating onto a file that lacks a trailing newline.
  let prefix = ''
  try {
    const existing = await readFile(file, 'utf8')
    if (existing.length > 0 && !existing.endsWith('\n')) prefix = '\n'
  } catch (err) {
    if (!isMissing(err)) throw err
  }
  await appendFile(file, `${prefix}${line}`, { mode: 0o600 })
}

// ─── Parked verifications (keyed by connId) ──────────────────────────────────
// Holds ssh2's verify(valid) callback until the UI answers. `verify` is a plain
// callback — NOT a secret. host/port/keyType/keyBase64 are all non-secret.

interface PendingHostKey {
  verify: (valid: boolean) => void
  host: string
  port: number
  keyType: string
  keyBase64: string
}

const pending = new Map<string, PendingHostKey>()

export function parkHostKey(connId: string, entry: PendingHostKey): void {
  const prev = pending.get(connId)
  if (prev) {
    // Should not happen (verifications are sequential per connId) — fail the
    // stale one closed rather than leak a dangling handshake.
    try {
      prev.verify(false)
    } catch {
      // callback already settled
    }
  }
  pending.set(connId, entry)
}

// Resolve a parked verification from ssh.confirmHostKey. Returns false when
// there was nothing parked (stale/duplicate confirm) so the caller can surface it.
export async function resolveHostKey(
  connId: string,
  accept: boolean,
  remember: boolean,
): Promise<boolean> {
  const entry = pending.get(connId)
  if (!entry) return false
  pending.delete(connId)
  if (accept && remember) {
    try {
      await appendKnownHost(entry.host, entry.port, entry.keyType, entry.keyBase64)
    } catch (err) {
      log.warn('ssh: failed to append known_hosts', { err: errMsg(err) })
    }
  }
  entry.verify(accept)
  return true
}

// Fail-closed cleanup for a parked verification whose connection is being torn
// down before the UI answered.
export function dropHostKey(connId: string): void {
  const entry = pending.get(connId)
  if (!entry) return
  pending.delete(connId)
  try {
    entry.verify(false)
  } catch {
    // callback already settled
  }
}
