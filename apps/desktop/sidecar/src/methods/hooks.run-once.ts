import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadHook } from '../hooks/store.js'
import { runHookOnce } from '../hooks/dispatcher.js'
import { loadProject } from '../projects/store.js'

const Params = z.object({
  id: z.string(),
  source: z.enum(['global', 'project']).optional(),
  projectId: z.string().optional(),
})

// Manual trigger with a representative mock payload. Honours the trust gate
// (D-8) — an untrusted project hook never spawns, even on demand.
register('hooks.run-once', async (raw) => {
  const params = Params.parse(raw)
  const source = params.source ?? 'global'
  const hook = await loadHook(params.id, source, params.projectId)
  if (!hook) throw new RpcError(-32602, `hook not found: ${params.id}`)

  let workspace = process.cwd()
  if (source === 'project' && params.projectId) {
    const project = await loadProject(params.projectId)
    if (!project) throw new RpcError(-32602, `Project not found: ${params.projectId}`)
    workspace = project.path
    // Trust gate: a project hook must be granted trust before it can spawn.
    const { listHooks } = await import('../hooks/store.js')
    const { hooks } = await listHooks([params.projectId])
    const tagged = hooks.find((h) => h.id === params.id && h.source === 'project')
    if (tagged && tagged.trusted === false) {
      throw new RpcError(-32602, 'Hook is not trusted yet — grant trust before running it')
    }
  }

  const mock: Record<string, unknown> = {
    path: `${workspace}/example.ts`,
    toolName: 'Write',
    status: 'completed',
  }
  const record = await runHookOnce(hook, mock, workspace)
  return { record }
})
