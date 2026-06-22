// gh.translate → translate one markdown segment (issue/pr title, body, or a
// single comment) to a target language via a pure-text one-shot (ADR 0049).
// Kind-agnostic: the UI calls it once per translatable segment, independently.
//
// Mirrors sessions.enhance-prompt.ts: prefer a cheap model per provider, fall
// back to the requested model if that fails (custom endpoint / invalid id /
// auth). The system prompt forbids touching markdown structure / code fences /
// links / @mentions / #refs / `identifiers` — only prose is translated.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { completePi } from '../runtime/complete.js'
import { log } from '../util/logger.js'
import type { ProviderName } from '../types/shared.js'

const Params = z.object({
  text: z.string().min(1).max(64_000),
  targetLang: z.string().min(1).max(80).optional(),
  provider: z.enum(['anthropic', 'openai', 'google']),
  modelId: z.string().min(1),
  accountId: z.string().optional(),
})

const DEFAULT_LANG = 'Vietnamese'

function buildSystemPrompt(targetLang: string): string {
  return `You are a professional technical translator. Translate the given GitHub markdown (an issue/PR title, body, or comment) into ${targetLang}.

Rules:
- Translate ONLY natural-language prose.
- Preserve VERBATIM, untranslated: all markdown structure and syntax, fenced/inline code blocks and their contents, URLs and link targets, @mentions, #issue/PR references, and \`identifiers\` (file paths, symbols, commands, technical tokens).
- Keep the markdown layout (headings, lists, tables, blockquotes, line breaks) identical.
- Do NOT add, remove, summarize, explain, or answer anything.
- Output ONLY the translation. No preamble, no surrounding quotes, no extra code fence.`
}

// Known low-cost models per provider (mirror sessions.enhancePrompt). Absent →
// use the requested model only.
const CHEAP_MODEL: Partial<Record<ProviderName, string>> = {
  anthropic: 'claude-haiku-4-5',
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:[a-zA-Z]*)?\s*([\s\S]*?)\s*```$/)
  if (fenced && fenced[1]) return fenced[1].trim()
  return trimmed
}

register('gh.translate', async (raw): Promise<{ text: string }> => {
  const params = Params.parse(raw)
  const targetLang = params.targetLang?.trim() || DEFAULT_LANG
  const systemPrompt = buildSystemPrompt(targetLang)

  // Try the cheap model first, then the requested model as a fallback.
  const cheap = CHEAP_MODEL[params.provider]
  const candidates = cheap && cheap !== params.modelId ? [cheap, params.modelId] : [params.modelId]

  let lastErr: unknown
  for (const modelId of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop -- intentional sequential fallback
      const out = await completePi({
        provider: params.provider,
        ...(params.accountId ? { accountId: params.accountId } : {}),
        modelId,
        systemPrompt,
        prompt: params.text,
      })
      const text = stripCodeFence(out)
      if (text) {
        log.info('gh.translate', { model: modelId, lang: targetLang, inChars: params.text.length })
        return { text }
      }
    } catch (err) {
      lastErr = err
      log.warn('gh.translate attempt failed', {
        model: modelId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  if (lastErr instanceof RpcError) throw lastErr
  throw new RpcError(-32021, 'Empty or failed response from model')
})
