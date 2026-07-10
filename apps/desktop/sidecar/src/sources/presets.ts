// Source-shaped presets for the Connections form + AI author (ADR 0060 D-7).
// Reuses the two built-in mcp presets (mcp/presets.ts) and reshapes the legacy
// flat McpServerConfig draft into a `SourceConfig` draft (type:'mcp', transport
// folded into the `mcp` block, `autoStart` dropped per ADR 0060 D-3).

import { buildPreset, PRESET_META, isPresetId, type PresetId } from '../mcp/presets.js'
import type { McpSource, McpSourceBlock } from '../types/shared.js'

// A preset draft the UI completes with id + slug before saving.
export type SourcePresetDraft = Omit<McpSource, 'id' | 'slug'>

export function buildSourcePreset(id: PresetId): SourcePresetDraft {
  const p = buildPreset(id)
  const mcp: McpSourceBlock = { transport: p.transport }
  if (p.transport === 'stdio') {
    if (p.command !== undefined) mcp.command = p.command
    if (p.args !== undefined) mcp.args = p.args
    if (p.env !== undefined) mcp.env = p.env
    if (p.cwd !== undefined) mcp.cwd = p.cwd
  } else {
    if (p.url !== undefined) mcp.url = p.url
    if (p.headers !== undefined) mcp.headers = p.headers
  }
  const draft: SourcePresetDraft = {
    name: p.name,
    // provider is a freeform label; the preset id is the most faithful default.
    provider: id,
    enabled: p.enabled,
    type: 'mcp',
    timeoutMs: p.timeoutMs,
    trust: p.trust,
    mcp,
  }
  if (p.description) draft.description = p.description
  return draft
}

export { PRESET_META, isPresetId }
export type { PresetId }
