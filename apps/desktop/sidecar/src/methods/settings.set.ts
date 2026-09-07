import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { saveSettings, unsetSettings } from '../settings/store.js'

// Write side of the layered settings store (the read pair lives in
// settings.get.ts).
//
//   settings.set   — patch-merge a blob into ONE tier. `scope` defaults to
//                    'user', so the existing single-tier callers are unchanged.
//   settings.unset — drop `slice` / `slice.field` paths from a tier; how a
//                    project override is cleared so the user tier shows through.
//
// `patch` must be a plain object carrying arbitrary string keys. z.record with a
// single value schema (zod v3) keys on string and rejects arrays / primitives /
// null — exactly the shape SettingsBlob expects. The dispatch layer turns a
// ZodError into an RPC -32602, so we just call .parse here (see projects.upsert).
const ScopeFields = {
  scope: z.enum(['user', 'project']).optional(),
  projectId: z.string().min(1).optional(),
}

const SetSchema = z.object({ patch: z.record(z.unknown()), ...ScopeFields })

register('settings.set', async (params) => {
  const { patch, scope, projectId } = SetSchema.parse(params)
  return await saveSettings(patch, scope ?? 'user', projectId)
})

// Cap the path list: it is a UI-driven array and a settings tier only ever has a
// few dozen keys, so anything larger is a bug or an abuse.
const UnsetSchema = z.object({
  paths: z.array(z.string().min(1).max(200)).min(1).max(200),
  ...ScopeFields,
})

register('settings.unset', async (params) => {
  const { paths, scope, projectId } = UnsetSchema.parse(params)
  return await unsetSettings(paths, scope ?? 'user', projectId)
})
