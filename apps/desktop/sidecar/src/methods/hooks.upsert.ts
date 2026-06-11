import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { HookConfigSchema } from '../hooks/schema.js'
import { loadHook, saveHook, saveImportedHook } from '../hooks/store.js'
import { invalidateHookCache } from '../hooks/dispatcher.js'
import type { Hook } from '../types/shared.js'

const Params = z.object({
  hook: HookConfigSchema.extend({
    source: z
      .enum(['global', 'project', 'claude-project', 'claude-local', 'claude-user'])
      .optional(),
    projectId: z.string().optional(),
  }),
  mode: z.enum(['create', 'update']),
})

register('hooks.upsert', async (raw) => {
  const params = Params.parse(raw)
  const incoming = params.hook
  const source = incoming.source ?? 'global'

  // Imported (claude-*) hook: patch the Claude Code settings.json entry in place
  // (command / matcher / timeout). No create/existence dance.
  const isImported = source !== 'global' && source !== 'project'
  if (isImported) {
    await saveImportedHook(source, incoming.projectId, incoming.id, {
      command: incoming.command,
      matcherGlob: incoming.matcher?.toolName,
      timeoutMs: incoming.timeoutMs,
    })
    invalidateHookCache()
    return { hook: { ...incoming, source } }
  }

  if (source === 'project' && !incoming.projectId) {
    throw new RpcError(-32602, 'Project hook requires a projectId')
  }
  const existing = await loadHook(incoming.id, source, incoming.projectId)
  if (params.mode === 'create' && existing) {
    throw new RpcError(-32602, `hook id already exists: ${incoming.id}`)
  }
  if (params.mode === 'update' && !existing) {
    throw new RpcError(-32602, `hook not found: ${incoming.id}`)
  }

  await saveHook(incoming as Hook)
  invalidateHookCache()
  return { hook: { ...incoming, source } }
})
