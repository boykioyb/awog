// SFTP file transfer over a live SSH connection (ADR 0063 P3). Every operation
// runs on the ssh2 client already opened by SshManager for a connId — grab it
// via sshManager.getRecord(connId), throw 'Unknown connection' when absent.
//
// One SFTP session is cached per connId (lazily opened, shared by concurrent
// callers via the cached open-promise). The cache entry is dropped when the
// session channel errors/closes, and when the SSH connection tears down (via the
// SshManager teardown hook) — so the next op transparently reopens.
//
// SECURITY:
//   - Remote paths live on the remote host, so no local-workspace guard applies;
//     we only reject NUL bytes (obviously malformed input).
//   - Local paths (download target / upload source) are the ONLY local
//     filesystem surface SSH touches. SSH has no project workspace, so the v1
//     sandbox is home-dir containment: a local path must resolve inside the
//     user's home directory (resolve() collapses any '..' — the containment
//     check then rejects anything that escapes home).

import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, posix, resolve, sep } from 'node:path'
import { emit } from '../transport/stdio.js'
import { RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import {
  sanitizeMessage,
  sshManager,
  type Ssh2Sftp,
  type Ssh2SftpDirEntry,
  type Ssh2SftpStats,
} from './manager.js'

// Preview read caps: default 1MB, hard max 5MB.
const DEFAULT_READ_CAP = 1_000_000
const HARD_READ_CAP = 5_000_000

export type SftpEntryType = 'file' | 'dir' | 'symlink' | 'other'

export type SftpEntry = {
  name: string
  type: SftpEntryType
  size: number
  mtime: number
  atime: number
  mode: number
  // Numeric POSIX ownership from the SFTP stat. Owner/group NAMES + ctime are not
  // in the SFTP protocol; they're enriched best-effort by statx() (see below).
  uid: number
  gid: number
}

// ─── Per-connId SFTP session cache ───────────────────────────────────────────

const sftpSessions = new Map<string, Promise<Ssh2Sftp>>()

// Drop cached sessions when the underlying SSH connection tears down.
sshManager.onTeardown((connId) => {
  sftpSessions.delete(connId)
})

async function openSftp(connId: string): Promise<Ssh2Sftp> {
  const cached = sftpSessions.get(connId)
  if (cached) return cached

  const record = sshManager.getRecord(connId)
  if (!record) throw new Error('Unknown connection')

  const opening = new Promise<Ssh2Sftp>((resolvePromise, reject) => {
    record.client.sftp((err, sftp) => {
      if (err) {
        reject(new Error(sanitizeMessage(err)))
        return
      }
      // Reopen on next use if the session channel dies.
      sftp.on('error', () => sftpSessions.delete(connId))
      sftp.on('close', () => sftpSessions.delete(connId))
      resolvePromise(sftp)
    })
  })
  sftpSessions.set(connId, opening)
  opening.catch(() => sftpSessions.delete(connId))
  return opening
}

// ─── Path handling ───────────────────────────────────────────────────────────

function sanitizeRemotePath(p: string): string {
  if (p.includes('\0')) throw new RpcError(-32602, 'invalid remote path')
  return p
}

function expandLocalHome(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return resolve(homedir(), input.slice(2))
  return input
}

async function assertInsideHome(localPath: string): Promise<string> {
  const abs = resolve(expandLocalHome(localPath))
  const home = homedir()
  const inHome = (p: string): boolean => p === home || p.startsWith(home + sep)
  if (!inHome(abs)) {
    throw new RpcError(-32602, 'local path must be inside home directory')
  }
  // Never let a transfer read/write the local secret dirs (F4): downloading into
  // ~/.ssh (authorized_keys) or ~/.awog (credentials.json) = persistence/exfil.
  for (const deny of [join(home, '.ssh'), join(home, '.awog')]) {
    if (abs === deny || abs.startsWith(deny + sep)) {
      throw new RpcError(-32602, 'local path is a protected directory')
    }
  }
  // Symlink escape (F4): resolve() collapses `..` but not symlinks, so a link
  // inside home (~/link -> /etc) would pass the prefix check while fastGet/fastPut
  // follows it out of home. Realpath the nearest existing ancestor and re-check.
  let probe = abs
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  try {
    if (!inHome(await realpath(probe))) {
      throw new RpcError(-32602, 'local path escapes home directory via a symlink')
    }
  } catch (err) {
    if (err instanceof RpcError) throw err
    throw new RpcError(-32602, 'local path could not be verified')
  }
  return abs
}

// ─── Promisified SFTP primitives ─────────────────────────────────────────────

function pReaddir(sftp: Ssh2Sftp, path: string): Promise<Ssh2SftpDirEntry[]> {
  return new Promise((res, rej) => {
    sftp.readdir(path, (err, list) => (err ? rej(new Error(sanitizeMessage(err))) : res(list)))
  })
}

function pLstat(sftp: Ssh2Sftp, path: string): Promise<Ssh2SftpStats> {
  return new Promise((res, rej) => {
    sftp.lstat(path, (err, stats) => (err ? rej(new Error(sanitizeMessage(err))) : res(stats)))
  })
}

function pMkdir(sftp: Ssh2Sftp, path: string): Promise<void> {
  return new Promise((res, rej) => {
    sftp.mkdir(path, (err) => (err ? rej(new Error(sanitizeMessage(err))) : res()))
  })
}

function pRename(sftp: Ssh2Sftp, from: string, to: string): Promise<void> {
  return new Promise((res, rej) => {
    sftp.rename(from, to, (err) => (err ? rej(new Error(sanitizeMessage(err))) : res()))
  })
}

function pUnlink(sftp: Ssh2Sftp, path: string): Promise<void> {
  return new Promise((res, rej) => {
    sftp.unlink(path, (err) => (err ? rej(new Error(sanitizeMessage(err))) : res()))
  })
}

function pRmdir(sftp: Ssh2Sftp, path: string): Promise<void> {
  return new Promise((res, rej) => {
    sftp.rmdir(path, (err) => (err ? rej(new Error(sanitizeMessage(err))) : res()))
  })
}

function entryType(attrs: Ssh2SftpStats): SftpEntryType {
  if (attrs.isSymbolicLink()) return 'symlink'
  if (attrs.isDirectory()) return 'dir'
  if (attrs.isFile()) return 'file'
  return 'other'
}

// Depth-first recursive delete. lstat/isSymbolicLink so we unlink symlinks
// rather than recursing through them into another tree.
async function removeDirRecursive(sftp: Ssh2Sftp, dir: string): Promise<void> {
  const entries = await pReaddir(sftp, dir)
  for (const e of entries) {
    if (e.filename === '.' || e.filename === '..') continue
    const child = posix.join(dir, e.filename)
    if (e.attrs.isDirectory() && !e.attrs.isSymbolicLink()) {
      await removeDirRecursive(sftp, child)
    } else {
      await pUnlink(sftp, child)
    }
  }
  await pRmdir(sftp, dir)
}

// ─── Transfer progress ───────────────────────────────────────────────────────

let transferSeq = 0
function genTransferId(): string {
  return `xfer-${Date.now().toString(36)}-${(transferSeq += 1).toString(36)}`
}

// Throttled progress emitter (>=150ms between ticks) with a guaranteed final
// tick, so a large transfer cannot flood the JSON-RPC stdout channel.
function transferProgress(connId: string, transferId: string) {
  let lastEmit = 0
  let transferred = 0
  let total = 0
  return {
    step(t: number, _chunk: number, tot: number): void {
      transferred = t
      total = tot
      const now = Date.now()
      if (now - lastEmit >= 150) {
        lastEmit = now
        emit('ssh:sftp-progress', { connId, transferId, transferred, total })
      }
    },
    finish(): void {
      emit('ssh:sftp-progress', { connId, transferId, transferred, total })
    },
    get bytes(): number {
      return transferred
    },
  }
}

// Read up to `cap` bytes via a stream, stopping early once the cap is exceeded.
function readCapped(
  sftp: Ssh2Sftp,
  path: string,
  cap: number,
): Promise<{ contentBase64: string; truncated: boolean }> {
  return new Promise((resolvePromise, reject) => {
    const stream = sftp.createReadStream(path)
    const chunks: Buffer[] = []
    let total = 0
    let truncated = false
    let done = false
    const finish = (err?: Error): void => {
      if (done) return
      done = true
      if (err) {
        reject(err)
        return
      }
      const buf = Buffer.concat(chunks)
      const sliced = buf.length > cap ? buf.subarray(0, cap) : buf
      resolvePromise({ contentBase64: sliced.toString('base64'), truncated })
    }
    stream.on('data', (chunk) => {
      total += chunk.length
      if (total >= cap) {
        truncated = total > cap
        chunks.push(chunk)
        stream.destroy()
        finish()
        return
      }
      chunks.push(chunk)
    })
    stream.on('error', (err) => finish(new Error(sanitizeMessage(err))))
    stream.on('end', () => finish())
    stream.on('close', () => finish())
  })
}

// ─── Public API (called by ssh.sftp.* method files) ──────────────────────────

export async function sftpList(connId: string, path: string): Promise<{ entries: SftpEntry[] }> {
  const sftp = await openSftp(connId)
  const list = await pReaddir(sftp, sanitizeRemotePath(path))
  return {
    entries: list.map((e) => ({
      name: e.filename,
      type: entryType(e.attrs),
      size: e.attrs.size,
      mtime: Math.round(e.attrs.mtime * 1000), // SFTP seconds → JS milliseconds
      atime: Math.round(e.attrs.atime * 1000),
      mode: e.attrs.mode,
      uid: e.attrs.uid,
      gid: e.attrs.gid,
    })),
  }
}

export async function sftpRead(
  connId: string,
  path: string,
  maxBytes?: number,
): Promise<{ contentBase64: string; truncated: boolean }> {
  const sftp = await openSftp(connId)
  const cap = Math.min(maxBytes ?? DEFAULT_READ_CAP, HARD_READ_CAP)
  return readCapped(sftp, sanitizeRemotePath(path), cap)
}

export async function sftpMkdir(connId: string, path: string): Promise<{ ok: true }> {
  const sftp = await openSftp(connId)
  await pMkdir(sftp, sanitizeRemotePath(path))
  return { ok: true }
}

export async function sftpRename(connId: string, from: string, to: string): Promise<{ ok: true }> {
  const sftp = await openSftp(connId)
  await pRename(sftp, sanitizeRemotePath(from), sanitizeRemotePath(to))
  return { ok: true }
}

export async function sftpDelete(
  connId: string,
  path: string,
  recursive: boolean,
): Promise<{ ok: true }> {
  const sftp = await openSftp(connId)
  const target = sanitizeRemotePath(path)
  const st = await pLstat(sftp, target)
  if (st.isDirectory()) {
    if (recursive) {
      await removeDirRecursive(sftp, target)
    } else {
      await pRmdir(sftp, target)
    }
  } else {
    await pUnlink(sftp, target)
  }
  return { ok: true }
}

export async function sftpDownload(
  connId: string,
  remotePath: string,
  localPath: string,
): Promise<{ ok: true; bytes: number }> {
  const sftp = await openSftp(connId)
  const remote = sanitizeRemotePath(remotePath)
  const local = await assertInsideHome(localPath)
  const transferId = genTransferId()
  const prog = transferProgress(connId, transferId)
  await new Promise<void>((resolvePromise, reject) => {
    sftp.fastGet(remote, local, { step: prog.step }, (err) =>
      err ? reject(new Error(sanitizeMessage(err))) : resolvePromise(),
    )
  })
  prog.finish()
  return { ok: true, bytes: prog.bytes }
}

// Hard cap on a single agent write (parity with the 5MB read cap, F3). The model
// can't produce this much in one call, but the cap bounds the remote-disk write
// surface as defense-in-depth.
const WRITE_CONTENT_CAP = 5_000_000

// Write a UTF-8 string to a remote path (ADR 0064 P2, agent ssh_write_file tool).
// Unlike sftpUpload (local file → remote), the content comes from the model, so
// there is NO local filesystem surface — only the remote path is touched. Uses
// the sftp writeFile convenience (truncates/overwrites). Returns the byte count.
export async function sftpWriteContent(
  connId: string,
  path: string,
  content: string,
): Promise<{ ok: true; bytes: number }> {
  const sftp = await openSftp(connId)
  const remote = sanitizeRemotePath(path)
  const buf = Buffer.from(content, 'utf8')
  if (buf.length > WRITE_CONTENT_CAP) {
    throw new RpcError(
      -32602,
      `remote write exceeds the ${WRITE_CONTENT_CAP}-byte cap (${buf.length} bytes)`,
    )
  }
  await new Promise<void>((resolvePromise, reject) => {
    sftp.writeFile(remote, buf, { encoding: 'utf8' }, (err) =>
      err ? reject(new Error(sanitizeMessage(err))) : resolvePromise(),
    )
  })
  return { ok: true, bytes: buf.length }
}

export async function sftpUpload(
  connId: string,
  localPath: string,
  remotePath: string,
): Promise<{ ok: true; bytes: number }> {
  const sftp = await openSftp(connId)
  const local = await assertInsideHome(localPath)
  const remote = sanitizeRemotePath(remotePath)
  const transferId = genTransferId()
  const prog = transferProgress(connId, transferId)
  await new Promise<void>((resolvePromise, reject) => {
    sftp.fastPut(local, remote, { step: prog.step }, (err) =>
      err ? reject(new Error(sanitizeMessage(err))) : resolvePromise(),
    )
  })
  prog.finish()
  return { ok: true, bytes: prog.bytes }
}

// ─── Native SFTP metadata / create (NO shell) ────────────────────────────────

// Change permission bits over the SFTP protocol directly — no remote shell is
// invoked, so there is no command-injection surface here. `mode` is validated to
// the standard permission range at the RPC boundary.
export async function sftpChmod(connId: string, path: string, mode: number): Promise<{ ok: true }> {
  const sftp = await openSftp(connId)
  const remote = sanitizeRemotePath(path)
  await new Promise<void>((res, rej) => {
    sftp.chmod(remote, mode, (err) => (err ? rej(new Error(sanitizeMessage(err))) : res()))
  })
  return { ok: true }
}

// Create a new EMPTY file. Uses the exclusive-create flag ('wx') so an existing
// path is a fast-fail rather than a silent truncate (mirrors mkdir semantics).
export async function sftpCreateFile(connId: string, path: string): Promise<{ ok: true }> {
  const sftp = await openSftp(connId)
  const remote = sanitizeRemotePath(path)
  await new Promise<void>((res, rej) => {
    sftp.writeFile(remote, '', { encoding: 'utf8', flag: 'wx' }, (err) =>
      err ? rej(new Error(sanitizeMessage(err))) : res(),
    )
  })
  return { ok: true }
}

// ─── Shell-backed operations (copy / archive / chown / enrichment) ────────────
//
// SFTP has no native primitive for these, so they run a one-shot command over
// the SSH connection via sshManager.exec. THIS IS A COMMAND-INJECTION SINK: the
// remote runs the string through its login shell. Every path/name that originates
// from the UI is passed through shellQuote(); the subcommand + option flags are
// fixed constants chosen HERE (never sent from the UI), and enum/charset params
// are validated at the RPC boundary before reaching these builders.

// POSIX single-quote escaping: wrap in single quotes and replace every embedded
// quote with the '\'' sequence. Renders any byte sequence (spaces, ;, $(), `, |,
// newlines) inert to the remote shell.
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

// Run a remote command and throw its stderr on a non-zero exit (fail-fast — the
// caller surfaces the message to the UI; nothing is swallowed). Output is already
// capped + timed by sshManager.exec.
async function execChecked(connId: string, command: string): Promise<string> {
  const { stdout, stderr, code } = await sshManager.exec(connId, command)
  if (code !== 0) {
    throw new Error((stderr || stdout || `command exited with code ${code}`).trim())
  }
  return stdout
}

// `cd <dir> && ` prefix so archive/enrichment commands run relative to a browsed
// directory with clean basenames. Home-relative '.' needs no cd (exec already
// starts in the login home dir).
function cdPrefix(dir: string): string {
  return dir && dir !== '.' ? `cd ${shellQuote(dir)} && ` : ''
}

export type CompressFormat = 'zip' | 'tar.gz' | 'tar.bz2' | 'tar.xz' | 'rar' | '7z'

// Copy files/dirs (recursive). `sources` + `dest` are full remote paths
// (home-relative or absolute) — exec starts in the login home dir.
export async function sftpCopy(
  connId: string,
  sources: string[],
  dest: string,
): Promise<{ ok: true }> {
  if (!sources.length) throw new RpcError(-32602, 'no sources to copy')
  const args = sources.map((s) => shellQuote(sanitizeRemotePath(s))).join(' ')
  await execChecked(connId, `cp -R -- ${args} ${shellQuote(sanitizeRemotePath(dest))}`)
  return { ok: true }
}

// Archive `entries` (basenames within `cwd`) into `archiveName` (within `cwd`).
export async function sftpCompress(
  connId: string,
  cwd: string,
  format: CompressFormat,
  entries: string[],
  archiveName: string,
): Promise<{ ok: true }> {
  if (!entries.length) throw new RpcError(-32602, 'no entries to compress')
  const cd = cdPrefix(sanitizeRemotePath(cwd))
  const a = shellQuote(sanitizeRemotePath(archiveName))
  const items = entries.map((e) => shellQuote(sanitizeRemotePath(e))).join(' ')
  const cmd: Record<CompressFormat, string> = {
    zip: `${cd}zip -r -q -- ${a} ${items}`,
    'tar.gz': `${cd}tar -czf ${a} -- ${items}`,
    'tar.bz2': `${cd}tar -cjf ${a} -- ${items}`,
    'tar.xz': `${cd}tar -cJf ${a} -- ${items}`,
    rar: `${cd}rar a -- ${a} ${items}`,
    '7z': `${cd}7z a -- ${a} ${items}`,
  }
  await execChecked(connId, cmd[format])
  return { ok: true }
}

// Extract `archive` (basename within `cwd`) into `cwd` (or a subdir). Format is
// derived from the archive extension — NOT trusted from the UI.
export async function sftpExtract(
  connId: string,
  cwd: string,
  archive: string,
  dest?: string,
): Promise<{ ok: true }> {
  const cd = cdPrefix(sanitizeRemotePath(cwd))
  const a = shellQuote(sanitizeRemotePath(archive))
  const destDir = dest && dest.trim() ? sanitizeRemotePath(dest) : '.'
  const d = shellQuote(destDir)
  const lower = archive.toLowerCase()
  let cmd: string
  // `-d <exdir>` MUST precede `--`; after `--` unzip treats it as a member-name
  // pattern (dest silently ignored → nothing extracted).
  if (lower.endsWith('.zip')) cmd = `${cd}unzip -o -d ${d} -- ${a}`
  else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) cmd = `${cd}tar -xzf ${a} -C ${d}`
  else if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2') || lower.endsWith('.tbz'))
    cmd = `${cd}tar -xjf ${a} -C ${d}`
  else if (lower.endsWith('.tar.xz') || lower.endsWith('.txz')) cmd = `${cd}tar -xJf ${a} -C ${d}`
  else if (lower.endsWith('.tar')) cmd = `${cd}tar -xf ${a} -C ${d}`
  else if (lower.endsWith('.rar')) cmd = `${cd}unrar x -o+ ${a} ${d}/`
  else if (lower.endsWith('.7z')) cmd = `${cd}7z x -y ${shellQuote('-o' + destDir)} -- ${a}`
  else if (lower.endsWith('.gz')) cmd = `${cd}gzip -dk -- ${a}`
  else if (lower.endsWith('.bz2')) cmd = `${cd}bzip2 -dk -- ${a}`
  else if (lower.endsWith('.xz')) cmd = `${cd}xz -dk -- ${a}`
  else throw new RpcError(-32602, `unsupported archive format: ${archive}`)
  await execChecked(connId, cmd)
  return { ok: true }
}

const OWNER_RE = /^[A-Za-z0-9._-]+$/

// Change owner (and optionally group). Usually needs root — a non-privileged
// failure surfaces its "Operation not permitted" message unchanged.
export async function sftpChown(
  connId: string,
  targets: string[],
  owner: string,
  group?: string,
  recursive?: boolean,
): Promise<{ ok: true }> {
  if (!targets.length) throw new RpcError(-32602, 'no targets')
  if (!OWNER_RE.test(owner)) throw new RpcError(-32602, 'invalid owner')
  if (group != null && group !== '' && !OWNER_RE.test(group)) {
    throw new RpcError(-32602, 'invalid group')
  }
  const spec = group ? `${owner}:${group}` : owner
  const files = targets.map((f) => shellQuote(sanitizeRemotePath(f))).join(' ')
  const flag = recursive ? '-R ' : ''
  await execChecked(connId, `chown ${flag}-- ${shellQuote(spec)} ${files}`)
  return { ok: true }
}

// Probe which archive tools exist on the remote (constant command, no UI input),
// so the UI can grey out unavailable compress/extract formats.
export async function sftpToolcheck(connId: string): Promise<{ tools: string[] }> {
  // Trailing `; :` forces exit 0 — otherwise the loop inherits the last iteration's
  // status (non-zero when the last probed tool is missing), which execChecked would
  // treat as failure and drop the whole result → every format shows "not installed".
  const out = await execChecked(
    connId,
    'for t in zip unzip tar gzip bzip2 xz rar unrar 7z 7za; do command -v "$t" >/dev/null 2>&1 && echo "$t"; done; :',
  )
  const tools = out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return { tools }
}

// ─── Enrichment: owner/group NAMES + ctime (best-effort) ──────────────────────
// SFTP gives numeric uid/gid + mtime/atime, but no owner/group name and no ctime.
// We shell out to `stat` for these. Fully optional: on any failure the UI falls
// back to numeric uid/gid and hides the Changed column.

type StatFlavor = 'gnu' | 'bsd' | 'none'
const statFlavors = new Map<string, StatFlavor>()
sshManager.onTeardown((connId) => statFlavors.delete(connId))

async function detectStatFlavor(connId: string): Promise<StatFlavor> {
  const cached = statFlavors.get(connId)
  if (cached) return cached
  let flavor: StatFlavor = 'none'
  try {
    const out = await execChecked(
      connId,
      "if stat -c '%U' . >/dev/null 2>&1; then echo gnu; elif stat -f '%Su' . >/dev/null 2>&1; then echo bsd; else echo none; fi",
    )
    const v = out.trim()
    if (v === 'gnu' || v === 'bsd') flavor = v
  } catch {
    flavor = 'none'
  }
  statFlavors.set(connId, flavor)
  return flavor
}

// Cap on how many entries we enrich in one `stat` call (bounds ARG_MAX + parse).
const STATX_CAP = 1000

export type SftpMeta = { owner: string; group: string; ctime: number }

// Enrich the entries in `dir` (given their basenames) with owner/group names +
// ctime (ms). Returns a name→meta map; entries beyond the cap are simply omitted
// (UI keeps its numeric fallback for them).
export async function sftpStatx(
  connId: string,
  dir: string,
  names: string[],
): Promise<{ meta: Record<string, SftpMeta> }> {
  const flavor = await detectStatFlavor(connId)
  if (flavor === 'none' || !names.length) return { meta: {} }

  const capped = names.slice(0, STATX_CAP)
  if (names.length > STATX_CAP) {
    log.warn(`ssh.sftp.statx: enriching first ${STATX_CAP} of ${names.length} entries in ${dir}`)
  }

  const cd = cdPrefix(sanitizeRemotePath(dir))
  const args = capped.map((n) => shellQuote(sanitizeRemotePath(n))).join(' ')
  // NAME is placed LAST so a tab inside a filename can't shift the other columns:
  // owner/group/ctime never contain tabs, so we split off exactly 3 fields.
  const fmt =
    flavor === 'gnu' ? "--printf '%U\\t%G\\t%Z\\t%n\\n'" : "-f '%Su\\t%Sg\\t%c\\t%N'"
  let out: string
  try {
    out = await execChecked(connId, `${cd}stat ${fmt} -- ${args}`)
  } catch (err) {
    log.warn(`ssh.sftp.statx failed: ${err instanceof Error ? err.message : String(err)}`)
    return { meta: {} }
  }

  const meta: Record<string, SftpMeta> = {}
  for (const line of out.split('\n')) {
    if (!line) continue
    const parts = line.split('\t')
    if (parts.length < 4) continue
    const [owner, group, ctimeRaw, ...rest] = parts
    const name = rest.join('\t')
    const ctimeSec = Number.parseInt(ctimeRaw, 10)
    meta[name] = {
      owner,
      group,
      ctime: Number.isFinite(ctimeSec) ? ctimeSec * 1000 : 0,
    }
  }
  return { meta }
}
