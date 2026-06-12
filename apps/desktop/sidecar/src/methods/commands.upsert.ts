import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadCommand, saveCommand } from '../commands/store.js'
import type { Command } from '../types/shared.js'

const Params = z.object({
  command: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().default(''),
    body: z.string().default(''),
    argumentHint: z.string().optional(),
    allowedTools: z.string().optional(),
    model: z.string().optional(),
    enabled: z.boolean().default(true),
    source: z.enum(['global', 'project']).optional(),
    projectId: z.string().optional(),
  }),
  mode: z.enum(['create', 'update']),
})

register('commands.upsert', async (raw) => {
  const params = Params.parse(raw)
  const incoming = params.command
  const source = incoming.source ?? 'global'

  if (source === 'project' && !incoming.projectId) {
    throw new RpcError(-32602, 'Project command requires a projectId')
  }
  const existing = await loadCommand(incoming.id, source, incoming.projectId)
  if (params.mode === 'create' && existing) {
    throw new RpcError(-32602, `command id already exists: ${incoming.id}`)
  }
  if (params.mode === 'update' && !existing) {
    throw new RpcError(-32602, `command not found: ${incoming.id}`)
  }

  await saveCommand(incoming as Command)
  return { command: { ...incoming, source } }
})
