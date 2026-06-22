// Resolve the repo cwd a repo-scoped gh command runs in from a projectId.
// SECURITY: the cwd is `project.path` loaded server-side — UI never sends any
// path/cwd (invariant: gh scope = workspace).
import { RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'

// 404 envelope code for a missing project (matches other not-found surfaces).
const PROJECT_NOT_FOUND = -32004

export async function resolveProjectCwd(projectId: string): Promise<string> {
  const project = await loadProject(projectId)
  if (!project) {
    throw new RpcError(PROJECT_NOT_FOUND, 'Project not found', { projectId })
  }
  return project.path
}
