// Path validate per ADR 0017 (3-step flow) + security invariant #2.
// All filesystem-bound inputs that come from UI/workspace go through this.
import { realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { RpcError } from '../transport/rpc.js'
import { GIT_RPC_CODE, GitErrorCode } from './error-map.js'

function deny(reason: string): never {
  throw new RpcError(GIT_RPC_CODE, 'Invalid path', {
    gitCode: GitErrorCode.INVALID_PATH,
    reason,
  })
}

// Returns absolute path inside workspaceRoot. Throws RpcError(INVALID_PATH)
// otherwise. `workspaceRoot` itself must already be absolute.
export function assertInsideWorkspace(workspaceRoot: string, userPath: string): string {
  if (typeof userPath !== 'string' || userPath.length === 0) deny('empty')
  // Reject literal `..` segment anywhere — cheap pre-check before resolve.
  const segments = userPath.split(/[\\/]+/)
  if (segments.includes('..')) deny('traversal-segment')

  const abs = resolve(workspaceRoot, userPath)
  if (abs !== workspaceRoot && !abs.startsWith(workspaceRoot + sep)) deny('outside-workspace')

  // realpath check — symlink must not escape. ENOENT is OK (file may not exist
  // yet, e.g. checkout file at commit creating a new path); other errors fail.
  try {
    const real = realpathSync.native(abs)
    if (real !== workspaceRoot && !real.startsWith(workspaceRoot + sep)) deny('symlink-escape')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') deny('realpath-failed')
  }
  return abs
}
