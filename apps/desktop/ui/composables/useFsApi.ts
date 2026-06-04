// Thin typed wrapper around the sidecar fs RPCs. Read-only methods feed the
// Session workspace Files / Preview tabs; the read-write + search methods back
// the Project Code Workspace (ADR 0022). Shape mirrors sidecar
// src/types/shared.ts. SoC: this only orchestrates IPC — no direct fs access.
import type { FsEntry, FsFileContent, FsSearchMatch } from '~/types'
import { useSidecar } from './useSidecar'

export interface FsSearchOptions {
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
  includeGlob?: string
  excludeGlob?: string
  maxResults?: number
}

export function useFsApi() {
  const sidecar = useSidecar()
  return {
    // ── Read ──────────────────────────────────────────────────────────────
    listDir: (workspaceRoot: string, path?: string) =>
      sidecar.request<{ entries: FsEntry[] }>('fs.listDir', {
        workspaceRoot,
        ...(path !== undefined ? { path } : {}),
      }),
    readFile: (workspaceRoot: string, path: string, maxBytes?: number) =>
      sidecar.request<FsFileContent>('fs.readFile', {
        workspaceRoot,
        path,
        ...(maxBytes !== undefined ? { maxBytes } : {}),
      }),

    // ── Write / file ops ──────────────────────────────────────────────────
    writeFile: (workspaceRoot: string, path: string, content: string) =>
      sidecar.request<{ bytesWritten: number }>('fs.writeFile', { workspaceRoot, path, content }),
    createFile: (workspaceRoot: string, path: string) =>
      sidecar.request<{ ok: true }>('fs.createFile', { workspaceRoot, path }),
    createDir: (workspaceRoot: string, path: string) =>
      sidecar.request<{ ok: true }>('fs.createDir', { workspaceRoot, path }),
    rename: (workspaceRoot: string, fromPath: string, toPath: string) =>
      sidecar.request<{ ok: true }>('fs.rename', { workspaceRoot, fromPath, toPath }),
    deletePath: (workspaceRoot: string, path: string, recursive?: boolean) =>
      sidecar.request<{ ok: true }>('fs.delete', {
        workspaceRoot,
        path,
        ...(recursive !== undefined ? { recursive } : {}),
      }),

    // ── Search ────────────────────────────────────────────────────────────
    search: (workspaceRoot: string, query: string, opts: FsSearchOptions = {}) =>
      sidecar.request<{ matches: FsSearchMatch[]; truncated: boolean }>('fs.search', {
        workspaceRoot,
        query,
        ...opts,
      }),

    // ── Watch (project-wide tree) ─────────────────────────────────────────
    watch: (workspaceRoot: string) => sidecar.request<{ ok: true }>('fs.watch', { workspaceRoot }),
    unwatch: (workspaceRoot: string) =>
      sidecar.request<{ ok: true }>('fs.unwatch', { workspaceRoot }),
  }
}
