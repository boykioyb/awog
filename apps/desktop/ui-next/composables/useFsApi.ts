// Thin typed wrapper around the sidecar fs RPCs (ADR 0022). The read methods feed
// the editor file tree + preview; the read-write + search methods back the Project
// Code Workspace + Task Artifact Editor. Method names are camelCase (fs.listDir,
// fs.readFile, …) — matching how WorkspaceFiles / usePreviewModal already call fs.
// SoC: this only orchestrates IPC — no direct fs access here.
//
// Dual-path: outside the Electron shell (`!sc.available`) the read methods return
// safe empty results and the write/search methods resolve to no-op shapes so
// browser-dev never throws (mirrors the dual-path stores).
import { useSidecar } from '~/composables/useSidecar'

// ── Minimal slice types (mirror sidecar src/types/shared.ts) ─────────────────
// Declared inline here so the editor feature owns its own fs contract slice.

// One entry from `fs.listDir`. `path` is workspace-relative (POSIX-style).
export interface FsEntry {
  name: string
  path: string
  kind: 'file' | 'dir'
  size?: number
}

// Result of `fs.readFile`. `content` is empty when `isBinary` or fully capped.
export interface FsFileContent {
  path: string
  content: string
  language?: string
  truncated: boolean
  isBinary: boolean
}

// Result of `fs.readFileBase64` — raw bytes (base64) + MIME for in-app binary
// preview (image / PDF). `base64` is '' + `truncated: true` when over the cap.
export interface FsFileBase64 {
  path: string
  base64: string
  mimeType: string
  size: number
  truncated: boolean
}

// One hit from `fs.search` (find-in-files). `line`/`column` are 1-based.
export interface FsSearchMatch {
  path: string
  line: number
  column: number
  preview: string
}

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
  const available = sidecar.available

  return {
    available,

    // ── Read ──────────────────────────────────────────────────────────────
    listDir: async (workspaceRoot: string, path?: string): Promise<{ entries: FsEntry[] }> => {
      if (!available) return { entries: [] }
      return sidecar.request<{ entries: FsEntry[] }>('fs.listDir', {
        workspaceRoot,
        ...(path !== undefined ? { path } : {}),
      })
    },
    listFiles: async (workspaceRoot: string): Promise<{ files: FsEntry[]; truncated: boolean }> => {
      if (!available) return { files: [], truncated: false }
      return sidecar.request<{ files: FsEntry[]; truncated: boolean }>('fs.listFiles', {
        workspaceRoot,
      })
    },
    readFile: async (
      workspaceRoot: string,
      path: string,
      maxBytes?: number,
    ): Promise<FsFileContent> => {
      if (!available) return { path, content: '', truncated: false, isBinary: false }
      return sidecar.request<FsFileContent>('fs.readFile', {
        workspaceRoot,
        path,
        ...(maxBytes !== undefined ? { maxBytes } : {}),
      })
    },
    // Raw bytes (base64) for in-app binary preview (image / PDF). Over the sidecar
    // cap → `{ base64: '', truncated: true }` so callers fall back to "open externally".
    readFileBase64: async (workspaceRoot: string, path: string): Promise<FsFileBase64> => {
      if (!available) return { path, base64: '', mimeType: '', size: 0, truncated: false }
      return sidecar.request<FsFileBase64>('fs.readFileBase64', { workspaceRoot, path })
    },

    // ── Write / file ops ──────────────────────────────────────────────────
    writeFile: async (
      workspaceRoot: string,
      path: string,
      content: string,
    ): Promise<{ bytesWritten: number }> => {
      if (!available) return { bytesWritten: 0 }
      return sidecar.request<{ bytesWritten: number }>('fs.writeFile', {
        workspaceRoot,
        path,
        content,
      })
    },
    createFile: async (workspaceRoot: string, path: string): Promise<{ ok: true }> => {
      if (!available) return { ok: true }
      return sidecar.request<{ ok: true }>('fs.createFile', { workspaceRoot, path })
    },
    createDir: async (workspaceRoot: string, path: string): Promise<{ ok: true }> => {
      if (!available) return { ok: true }
      return sidecar.request<{ ok: true }>('fs.createDir', { workspaceRoot, path })
    },
    rename: async (
      workspaceRoot: string,
      fromPath: string,
      toPath: string,
    ): Promise<{ ok: true }> => {
      if (!available) return { ok: true }
      return sidecar.request<{ ok: true }>('fs.rename', { workspaceRoot, fromPath, toPath })
    },
    deletePath: async (
      workspaceRoot: string,
      path: string,
      recursive?: boolean,
    ): Promise<{ ok: true }> => {
      if (!available) return { ok: true }
      return sidecar.request<{ ok: true }>('fs.delete', {
        workspaceRoot,
        path,
        ...(recursive !== undefined ? { recursive } : {}),
      })
    },

    // ── Search ────────────────────────────────────────────────────────────
    search: async (
      workspaceRoot: string,
      query: string,
      opts: FsSearchOptions = {},
    ): Promise<{ matches: FsSearchMatch[]; truncated: boolean }> => {
      if (!available) return { matches: [], truncated: false }
      return sidecar.request<{ matches: FsSearchMatch[]; truncated: boolean }>('fs.search', {
        workspaceRoot,
        query,
        ...opts,
      })
    },

    // ── Watch (project-wide tree) ─────────────────────────────────────────
    watch: async (workspaceRoot: string): Promise<{ ok: true }> => {
      if (!available) return { ok: true }
      return sidecar.request<{ ok: true }>('fs.watch', { workspaceRoot })
    },
    unwatch: async (workspaceRoot: string): Promise<{ ok: true }> => {
      if (!available) return { ok: true }
      return sidecar.request<{ ok: true }>('fs.unwatch', { workspaceRoot })
    },
  }
}
