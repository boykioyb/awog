// Read a Source's guide.md raw markdown (ADR 0060, P5 UI parity — the
// Documentation section of the Craft-style SourceInfoPage). Read-only: returns
// the raw markdown string (or null when the source has no guide.md). No
// mutation, no secret — guide.md is authored content, never a credential.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { readGuide } from '../sources/store.js'
import { SOURCE_SLUG_RE } from '../sources/schema.js'

const Params = z.object({
  slug: z.string().regex(SOURCE_SLUG_RE),
})

register('source.guide', async (raw) => {
  const { slug } = Params.parse(raw)
  const guide = await readGuide(slug)
  return { guide: guide?.raw ?? null }
})
