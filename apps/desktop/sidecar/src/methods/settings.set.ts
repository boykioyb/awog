import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { saveSettings } from '../settings/store.js'

// `patch` must be a plain object carrying arbitrary string keys. z.record with a
// single value schema (zod v3) keys on string and rejects arrays / primitives /
// null — exactly the shape SettingsBlob expects. The dispatch layer turns a
// ZodError into an RPC -32602, so we just call .parse here (see projects.upsert).
const Schema = z.object({ patch: z.record(z.unknown()) })

register('settings.set', async (params) => {
  const { patch } = Schema.parse(params)
  const merged = await saveSettings(patch)
  return merged
})
