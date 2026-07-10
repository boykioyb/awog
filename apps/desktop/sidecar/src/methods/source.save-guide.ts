// Write a Source's guide.md raw markdown (ADR 0060, P5 UI parity — the edit
// affordance on the Documentation section of the Craft-style SourceInfoPage).
// Create/overwrite atomically; empty / whitespace-only content DELETES the file
// (see saveGuide — a source with no guide.md is the canonical "no documentation"
// state). No secret — guide.md is authored content, never a credential. Byte-cap
// is enforced here so a runaway paste can't bloat the store / RPC payload.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { saveGuide, GUIDE_MAX_BYTES } from '../sources/store.js'
import { SOURCE_SLUG_RE } from '../sources/schema.js'

const Params = z.object({
  slug: z.string().regex(SOURCE_SLUG_RE),
  content: z.string(),
})

register('source.saveGuide', async (raw) => {
  const { slug, content } = Params.parse(raw)
  if (Buffer.byteLength(content, 'utf8') > GUIDE_MAX_BYTES) {
    throw new RpcError(-32602, `guide.md exceeds the ${GUIDE_MAX_BYTES}-byte size cap`)
  }
  await saveGuide(slug, content)
  return { ok: true }
})
