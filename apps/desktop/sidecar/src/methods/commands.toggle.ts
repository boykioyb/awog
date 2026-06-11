import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadCommand, saveCommand } from '../commands/store.js'

const Params = z.object({
  id: z.string(),
  // Only AWOG-native commands carry an `enabled` flag; imported Claude Code
  // commands have no such concept, so toggle is restricted to global/project.
  source: z.enum(['global', 'project']).optional(),
  projectId: z.string().optional(),
  enabled: z.boolean(),
})

register('commands.toggle', async (raw) => {
  const params = Params.parse(raw)
  const command = await loadCommand(params.id, params.source ?? 'global', params.projectId)
  if (!command) throw new RpcError(-32602, `command not found: ${params.id}`)
  command.enabled = params.enabled
  await saveCommand(command)
  return { id: params.id, enabled: params.enabled }
})
