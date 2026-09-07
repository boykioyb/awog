import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { loadScoped, resolveSettings } from '../settings/store.js'

// Read side of the layered settings store. Both READ methods live in this file
// (the write pair lives in settings.set.ts) — index.ts imports one module per
// pair, so a new method needs no change outside the settings surface.
//
//   settings.get     — one tier's raw blob. No params ⇒ the user tier, byte for
//                      byte what ~/.awog/settings.json holds. That default is
//                      load-bearing: the Electron remote gateway calls
//                      `settings.get` with null params and reads `defaults`.
//   settings.resolve — both tiers + the merged result + the origin map the UI
//                      needs to show which tier a value came from.
const GetSchema = z
  .object({
    scope: z.enum(['user', 'project']).optional(),
    projectId: z.string().min(1).optional(),
  })
  .nullish()

register('settings.get', async (params) => {
  const args = GetSchema.parse(params) ?? {}
  return await loadScoped(args.scope ?? 'user', args.projectId)
})

const ResolveSchema = z.object({ projectId: z.string().min(1).optional() }).nullish()

register('settings.resolve', async (params) => {
  const args = ResolveSchema.parse(params) ?? {}
  return await resolveSettings(args.projectId)
})
