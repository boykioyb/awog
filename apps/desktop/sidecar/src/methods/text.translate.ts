// text.translate → app-wide one-shot translation (ADR 0049). Same contract as
// gh.translate but provider-neutral in name: used by the selection-to-translate
// feature (highlight text in a session / preview → translate). Thin wrapper over
// the shared translate core (runtime/translate.ts).

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

register('text.translate', async (raw): Promise<{ text: string }> => {
  const params = Params.parse(raw)
  const text = await translateText(params)
  return { text }
})
