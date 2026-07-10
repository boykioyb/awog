// Resolve a Source's icon into a renderable form for the UI (ADR 0060, UI-parity
// area 1). Read-only: returns an emoji, a base64 `data:` URI (from a local file,
// a downloaded config.icon URL, or a fetched favicon — all SSRF-guarded + cached),
// or { kind: 'none' } so the UI draws the lucide type glyph. Never leaks a
// credential — an icon is public, non-secret content. Never throws (resolveSourceIcon
// collapses every failure to { kind: 'none' }).

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { SOURCE_SLUG_RE } from '../sources/schema.js'
import { resolveSourceIcon } from '../sources/icon.js'

const Params = z.object({
  slug: z.string().regex(SOURCE_SLUG_RE),
})

register('source.resolveIcon', async (raw) => {
  const { slug } = Params.parse(raw)
  const icon = await resolveSourceIcon(slug)
  return { icon }
})
