// Return a source-shaped preset draft for the Connections form (ADR 0060 P1).
// Successor to mcp.discoverPreset — same two built-in mcp presets, reshaped into
// a SourceConfig draft the UI completes with id + slug before saving.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { buildSourcePreset, isPresetId, PRESET_META } from '../sources/presets.js'

const Params = z.object({
  presetId: z.string(),
})

register('source.discoverPreset', async (raw) => {
  const { presetId } = Params.parse(raw)
  if (!isPresetId(presetId)) {
    throw new RpcError(-32602, `unknown preset: ${presetId}`)
  }
  return {
    preset: buildSourcePreset(presetId),
    meta: PRESET_META[presetId],
  }
})
