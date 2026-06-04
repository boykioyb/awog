import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { buildPreset, isPresetId, PRESET_META } from '../mcp/presets.js'

const Params = z.object({
  presetId: z.string(),
})

register('mcp.discoverPreset', async (raw) => {
  const { presetId } = Params.parse(raw)
  if (!isPresetId(presetId)) {
    throw new RpcError(-32602, `unknown preset: ${presetId}`)
  }
  return {
    preset: buildPreset(presetId),
    meta: PRESET_META[presetId],
  }
})
