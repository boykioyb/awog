import { realpathSync } from 'node:fs'
import { join, sep } from 'node:path'

// Validate that `relPath` resolves to a real path inside `root`. Canonicalize
// both sides (realpath resolves `..` + symlinks) and require descendant-ship —
// mirrors the sidecar's assertInsideWorkspace + the old Rust
// resolve_inside_workspace (security invariant #2). Shared by the IPC shell
// handlers (ipc.ts) and the media:// streaming protocol (media.ts) so the
// workspace-scope check lives in exactly one place.
export function resolveInsideWorkspace(root: string, relPath: string): string {
  if (!root) throw new Error('workspace root is empty')
  if (!relPath) throw new Error('path is empty')
  const rootCanon = realpathSync(root)
  const targetCanon = realpathSync(join(rootCanon, relPath))
  if (targetCanon !== rootCanon && !targetCanon.startsWith(rootCanon + sep)) {
    throw new Error(`path escapes workspace: ${targetCanon}`)
  }
  return targetCanon
}
