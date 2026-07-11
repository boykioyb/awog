// Return a ready-to-edit source draft for a catalog preset (UI-parity area 3).
// The picker calls this after the user chooses a common provider; the UI seeds
// the ConnectionEditor with the returned `preset` draft (correct mcp/api/local
// block pre-filled) and shows `meta.setupHint`. NO real secret is ever included
// — stdio env keys are seeded empty and api credentials are entered write-only.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { buildPresetDraft, PRESET_CATALOG } from '../sources/preset-catalog.js'

const Params = z.object({
  presetId: z.string(),
})

register('source.discoverPreset', async (raw) => {
  const { presetId } = Params.parse(raw)
  const entry = PRESET_CATALOG[presetId]
  const preset = buildPresetDraft(presetId)
  if (!entry || !preset) {
    throw new RpcError(-32602, `unknown preset: ${presetId}`)
  }
  return { preset, meta: entry.meta }
})
