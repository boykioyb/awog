import { realpathSync } from 'node:fs'
import { isAbsolute, join, sep } from 'node:path'

// Validate that `filePath` resolves to a real path inside `root`. Canonicalize both sides
// (realpath resolves `..` + symlinks) and require descendant-ship — mirrors the sidecar's
// assertInsideWorkspace + the old Rust resolve_inside_workspace (security invariant #2).
// Shared by the IPC shell handlers (ipc.ts), the media:// streaming protocol (media.ts) and
// the preview popout (preview-window.ts) so the workspace-scope check lives in exactly one
// place.
//
// `filePath` may be workspace-RELATIVE or an ABSOLUTE path inside the root. Both shapes
// reach us: a path a model wrote in chat is opened as-is (the sidecar's path sanitizer
// resolves either against the root), so the same preview item must work for the file read
// (sidecar) and for reveal / open-externally / media streaming (here). This used to use
// join() alone, which does NOT reset on an absolute path — `join('/repo', '/Users/x.mp4')`
// silently becomes `/repo/Users/x.mp4`, a file that doesn't exist. That is why a video
// opened from a chat file link failed to play ("can't play this media") while the same file
// opened from the Files tab (relative path) played fine.
//
// Containment is still enforced against the canonical root, so an absolute path OUTSIDE the
// workspace is rejected exactly as before.
export function resolveInsideWorkspace(root: string, filePath: string): string {
  if (!root) throw new Error('workspace root is empty')
  if (!filePath) throw new Error('path is empty')
  const rootCanon = realpathSync(root)
  const targetCanon = realpathSync(isAbsolute(filePath) ? filePath : join(rootCanon, filePath))
  if (targetCanon !== rootCanon && !targetCanon.startsWith(rootCanon + sep)) {
    throw new Error(`path escapes workspace: ${targetCanon}`)
  }
  return targetCanon
}
