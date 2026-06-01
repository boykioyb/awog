import { z } from 'zod'
import { readdir, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import type { FsEntry } from '../types/shared.js'

// Read-only directory listing for the Session workspace Files tab. Lazy
// per-directory (the UI expands one level at a time). Security invariant #2:
// every resolved path must stay inside workspaceRoot.

const Params = z.object({
  workspaceRoot: z.string().min(1),
  // Workspace-relative directory. Empty / omitted = workspace root.
  path: z.string().optional(),
})

// Directories never worth surfacing in a workspace file tree.
const SKIP = new Set(['.git'])

register('fs.listDir', async (raw): Promise<{ entries: FsEntry[] }> => {
  const params = Params.parse(raw)
  if (!isAbsolute(params.workspaceRoot)) {
    throw new RpcError(-32602, 'workspaceRoot must be absolute')
  }
  const relDir = params.path ?? ''
  const absDir = assertInsideWorkspace(params.workspaceRoot, relDir || '.')

  const dirents = await readdir(absDir, { withFileTypes: true })
  const entries: FsEntry[] = []

  await Promise.all(
    dirents.map(async (dirent) => {
      const { name } = dirent
      if (SKIP.has(name)) return
      const childRel = relDir ? `${relDir}/${name}` : name

      // Re-validate each child (a symlink could point outside the workspace).
      let absChild: string
      try {
        absChild = assertInsideWorkspace(params.workspaceRoot, childRel)
      } catch {
        return // skip entries that escape the workspace
      }

      let kind: FsEntry['kind']
      let size: number | undefined
      if (dirent.isDirectory()) {
        kind = 'dir'
      } else if (dirent.isFile()) {
        kind = 'file'
      } else {
        // Symlink / other — resolve target type via stat (follows the link).
        try {
          const st = await stat(absChild)
          kind = st.isDirectory() ? 'dir' : 'file'
          if (kind === 'file') size = st.size
        } catch {
          return
        }
      }
      if (kind === 'file' && size === undefined) {
        try {
          size = (await stat(absChild)).size
        } catch {
          size = undefined
        }
      }

      const entry: FsEntry = { name, path: childRel, kind }
      if (size !== undefined) entry.size = size
      entries.push(entry)
    }),
  )

  // Directories first, then alphabetical (locale-agnostic).
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return { entries }
})
