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
  mode: number
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
      mode: e.attrs.mode,
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
