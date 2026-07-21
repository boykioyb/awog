// Thin typed wrapper around the sidecar ssh.* live-session RPCs (ADR 0063 P2–P4).
// Interactive-shell output flows back via `ssh:data` / `ssh:exit` (routed by
// WorkspaceTerminal's SSH transport); the host-key prompt arrives on
// `ssh:host-key-prompt` and SFTP transfer progress on `ssh:sftp-progress`. CRUD
// lives in the ssh store; this covers the connection / SFTP / forward surface the
// terminal + browser panels drive. Mirrors useTerminalApi.
import { useSidecar } from './useSidecar'
import type { PortForward, SshKeyType } from '~/stores/ssh'

export type SftpEntryType = 'file' | 'dir' | 'symlink' | 'other'
export interface SftpEntry {
  name: string
  type: SftpEntryType
  size: number
  mtime: number
  atime: number
  mode: number
  uid: number
  gid: number
}
// Enrichment (owner/group NAMES + ctime) resolved best-effort via ssh.sftp.statx.
export interface SftpMeta {
  owner: string
  group: string
  ctime: number
}
export type CompressFormat = 'zip' | 'tar.gz' | 'tar.bz2' | 'tar.xz' | 'rar' | '7z'
export interface SshForwardInfo {
  forwardId: string
  connId: string
  forward: PortForward
  status: 'active' | 'error'
  error?: string
}

export function useSshApi() {
  const sidecar = useSidecar()
  return {
    // ── connection / shell ──
    connect: (hostId: string, cols: number, rows: number) =>
      sidecar.request<{ connId: string }>('ssh.connect', { hostId, cols, rows }),
    write: (connId: string, data: string) =>
      sidecar.request<{ ok: true }>('ssh.write', { connId, data }),
    resize: (connId: string, cols: number, rows: number) =>
      sidecar.request<{ ok: true }>('ssh.resize', { connId, cols, rows }),
    disconnect: (connId: string) => sidecar.request<{ ok: true }>('ssh.disconnect', { connId }),
    exec: (connId: string, command: string) =>
      sidecar.request<{ stdout: string; stderr: string; code: number }>('ssh.exec', {
        connId,
        command,
      }),
    test: (hostId: string) =>
      sidecar.request<{ status: 'connected' | 'error'; error?: string }>('ssh.test', { hostId }),
    confirmHostKey: (connId: string, accept: boolean, remember: boolean) =>
      sidecar.request<{ ok: true }>('ssh.confirmHostKey', { connId, accept, remember }),
    // Auto-detect a key's type from its path (prefers the sibling .pub) or pasted
    // material. Returns null when undetectable. The key content stays in sidecar.
    detectKeyType: (opts: { keyPath?: string; privateKey?: string }) =>
      sidecar.request<{ keyType: SshKeyType | null }>('ssh.detectKeyType', opts),

    // ── SFTP (P3) ──
    sftpList: (connId: string, path: string) =>
      sidecar.request<{ entries: SftpEntry[] }>('ssh.sftp.list', { connId, path }),
    sftpRead: (connId: string, path: string, maxBytes?: number) =>
      sidecar.request<{ contentBase64: string; truncated: boolean }>('ssh.sftp.read', {
        connId,
        path,
        ...(maxBytes != null ? { maxBytes } : {}),
      }),
    sftpMkdir: (connId: string, path: string) =>
      sidecar.request<{ ok: true }>('ssh.sftp.mkdir', { connId, path }),
    sftpRename: (connId: string, from: string, to: string) =>
      sidecar.request<{ ok: true }>('ssh.sftp.rename', { connId, from, to }),
    sftpDelete: (connId: string, path: string, recursive: boolean) =>
      sidecar.request<{ ok: true }>('ssh.sftp.delete', { connId, path, recursive }),
    sftpDownload: (connId: string, remotePath: string, localPath: string) =>
      sidecar.request<{ ok: true; bytes: number }>('ssh.sftp.download', {
        connId,
        remotePath,
        localPath,
      }),
    sftpUpload: (connId: string, localPath: string, remotePath: string) =>
      sidecar.request<{ ok: true; bytes: number }>('ssh.sftp.upload', {
        connId,
        localPath,
        remotePath,
      }),

    // ── SFTP file-manager ops ──
    sftpChmod: (connId: string, path: string, mode: number) =>
      sidecar.request<{ ok: true }>('ssh.sftp.chmod', { connId, path, mode }),
    sftpCreateFile: (connId: string, path: string) =>
      sidecar.request<{ ok: true }>('ssh.sftp.createFile', { connId, path }),
    sftpCopy: (connId: string, sources: string[], dest: string) =>
      sidecar.request<{ ok: true }>('ssh.sftp.copy', { connId, sources, dest }),
    sftpCompress: (
      connId: string,
      cwd: string,
      format: CompressFormat,
      entries: string[],
      archiveName: string,
    ) =>
      sidecar.request<{ ok: true }>('ssh.sftp.compress', {
        connId,
        cwd,
        format,
        entries,
        archiveName,
      }),
    sftpExtract: (connId: string, cwd: string, archive: string, dest?: string) =>
      sidecar.request<{ ok: true }>('ssh.sftp.extract', {
        connId,
        cwd,
        archive,
        ...(dest != null ? { dest } : {}),
      }),
    sftpChown: (
      connId: string,
      targets: string[],
      owner: string,
      group?: string,
      recursive?: boolean,
    ) =>
      sidecar.request<{ ok: true }>('ssh.sftp.chown', {
        connId,
        targets,
        owner,
        ...(group != null ? { group } : {}),
        ...(recursive != null ? { recursive } : {}),
      }),
    sftpToolcheck: (connId: string) =>
      sidecar.request<{ tools: string[] }>('ssh.sftp.toolcheck', { connId }),
    sftpStatx: (connId: string, dir: string, names: string[]) =>
      sidecar.request<{ meta: Record<string, SftpMeta> }>('ssh.sftp.statx', {
        connId,
        dir,
        names,
      }),

    // ── port forwarding (P4) ──
    forwardStart: (connId: string, forward: PortForward) =>
      sidecar.request<{ forwardId: string }>('ssh.forward.start', { connId, forward }),
    forwardStop: (forwardId: string) =>
      sidecar.request<{ ok: true }>('ssh.forward.stop', { forwardId }),
    forwardList: (connId?: string) =>
      sidecar.request<{ forwards: SshForwardInfo[] }>('ssh.forward.list', {
        ...(connId != null ? { connId } : {}),
      }),
  }
}
