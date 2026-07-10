import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { loadSource } from '../sources/store.js'
import { SOURCE_SLUG_RE } from '../sources/schema.js'

const Params = z.object({
  slug: z.string().regex(SOURCE_SLUG_RE),
})

// Read-only: load a single Source config by slug (null when not found). See
// ADR 0060 (P0).
register('source.get', async (raw) => {
  const { slug } = Params.parse(raw)
  const source = await loadSource(slug)
  return { source }
})
