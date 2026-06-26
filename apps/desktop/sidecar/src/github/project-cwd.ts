// Resolve the repo cwd a repo-scoped gh command runs in from a projectId.
// SECURITY: the cwd is `project.path` loaded server-side — UI never sends any
// path/cwd (invariant: gh scope = workspace).
import { resolve, sep } from 'node:path'
import { RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'

// 404 envelope code for a missing project (matches other not-found surfaces).
const PROJECT_NOT_FOUND = -32004

// Resolve the cwd a repo-scoped gh command runs in. `repoPath` (optional) targets
// a child repo of a multi-repo workspace — a path RELATIVE to project.path (a
// discovered repo's relativePath), validated to stay inside project.path.
// SECURITY: the base path is loaded server-side; UI never sends an absolute cwd.
export async function resolveProjectCwd(projectId: string, repoPath?: string): Promise<string> {
  const project = await loadProject(projectId)
  if (!project) {
    throw new RpcError(PROJECT_NOT_FOUND, 'Project not found', { projectId })
  }
  if (!repoPath || repoPath === '.') return project.path
  if (repoPath.includes('..')) {
    throw new RpcError(-32602, 'repoPath must not contain ".."')
  }
  const abs = resolve(project.path, repoPath)
  if (abs !== project.path && !abs.startsWith(project.path + sep)) {
    throw new RpcError(-32602, 'repoPath escapes the project root')
  }
  return abs
}
