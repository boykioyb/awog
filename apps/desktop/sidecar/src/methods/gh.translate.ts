// gh.translate → translate one markdown segment (issue/pr title, body, or a
// single comment) to a target language via a pure-text one-shot (ADR 0049).
// Kind-agnostic: the UI calls it once per translatable segment, independently.
//
// Thin wrapper over the shared translate core (runtime/translate.ts). The core
// prefers a cheap model per provider, falls back to the requested model, and
// keeps markdown structure / code fences / links / @mentions / #refs /
// `identifiers` verbatim — only prose is translated.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { translateText } from '../runtime/translate.js'

const Params = z.object({
  text: z.string().min(1).max(64_000),
  targetLang: z.string().min(1).max(80).optional(),
  provider: z.enum(['anthropic', 'openai', 'google']),
  modelId: z.string().min(1),
  accountId: z.string().optional(),
})

register('gh.translate', async (raw): Promise<{ text: string }> => {
  const params = Params.parse(raw)
  // High-volume issue/PR prose → prefer the cheap model, fall back to requested.
  const text = await translateText(params, { preferCheap: true })
  return { text }
})
