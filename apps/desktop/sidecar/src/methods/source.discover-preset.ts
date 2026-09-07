// Return a ready-to-edit source draft for a catalog preset (UI-parity area 3).
// The picker calls this after the user chooses a common provider; the UI seeds
// the ConnectionEditor with the returned `preset` draft (correct mcp/api/local
// block pre-filled) and shows `meta.setupHint`. NO real secret is ever included
// — stdio env keys are seeded empty and api credentials are entered write-only.
//
// Gói #38: cùng method này cũng giải id động `reg:<name>` của MCP Registry
// (sources/registry.ts). Một đường ra duy nhất cho cả catalog tĩnh lẫn động ⇒ UI
// và luồng đồng ý của người dùng KHÔNG đổi: nhận bản nháp → soi trong
// ConnectionEditor → tự bấm Save. Method này không ghi gì và không chạy gì.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { buildPresetDraft, PRESET_CATALOG } from '../sources/preset-catalog.js'
import { buildRegistryDraft, getRegistryEntry, isRegistryId, registryMeta } from '../sources/registry.js'

const Params = z.object({
  presetId: z.string().max(400),
})

register('source.discoverPreset', async (raw) => {
  const { presetId } = Params.parse(raw)

  if (isRegistryId(presetId)) {
    const entry = await getRegistryEntry(presetId)
    if (!entry) throw new RpcError(-32602, `unknown registry entry: ${presetId}`)
    const preset = buildRegistryDraft(entry)
    // 'unsupported' = AWOG không dựng được lệnh an toàn cho loại package này.
    // Đoán bừa một `command` từ dữ liệu bên thứ ba là đúng thứ phải tránh.
    if (!preset) {
      throw new RpcError(-32602, `registry entry is not installable from AWOG: ${entry.name}`)
    }
    return { preset, meta: registryMeta(entry) }
  }

  const entry = PRESET_CATALOG[presetId]
  const preset = buildPresetDraft(presetId)
  if (!entry || !preset) {
    throw new RpcError(-32602, `unknown preset: ${presetId}`)
  }
  return { preset, meta: entry.meta }
})
