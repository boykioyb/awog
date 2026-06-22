// AI-enhanced version of the user's composer draft.
//
// Pure-text one-shot through the Pi runtime (like git.generateCommitMessage /
// sessions.generateTitle): rewrite the user's raw prompt into a clearer, more
// specific, better-structured prompt WITHOUT changing intent. Called by the
// Session composer's "enhance" button; the result replaces the draft (the UI
// keeps the original for one-click undo).
//
// Cheap-model strategy mirrors sessions.generateTitle: prefer a known low-cost
// model for the provider; if that fails (custom endpoint that doesn't serve it,
// invalid id, auth) fall back to the session's own model so a result is still
// produced.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { completePi } from '../runtime/complete.js'
import { log } from '../util/logger.js'
import type { ProviderName } from '../types/shared.js'

const Params = z.object({
  text: z.string().min(1).max(16_000),
  provider: z.enum(['anthropic', 'openai', 'google']),
  modelId: z.string().min(1),
  accountId: z.string().optional(),
})

const ENHANCE_SYS = `You are a prompt rewriter. Take the user's raw, messy input and rewrite it as a single, clear, complete REQUEST that the user is sending to an AI coding/agent assistant — improving structure and specificity WITHOUT changing the user's intent.

The output IS the user's request, rewritten well (first person, as if the user phrased it clearly). It is NOT a response to the request.

You MUST NOT:
- Answer, explain, solve, debug, or execute the request.
- Speculate about causes, list possible reasons, or add any analysis.
- Ask the user clarifying questions back, or offer the user a menu of options.
- Add new requirements, scope, or details the user did not state or clearly imply.

You MUST:
- Preserve the original language (Vietnamese stays Vietnamese).
- Keep the user's intent and scope exactly. Turn vague phrasing into a clear ask: state the context, then the concrete request.
- Preserve verbatim any @file/path mentions, $agent names, /command invocations, code blocks, file paths, identifiers, and error text — do not rephrase, translate, or remove them.
- Output ONLY the rewritten prompt. No preamble, no explanation, no surrounding quotes, no markdown code fence.

Example
RAW: ủa là sao nhỉ trên app awog: 400 {"type":"error","error":{"message":"You're out of extra usage..."}} trong phần session? rõ ràng vẫn còn token
REWRITTEN: Trên app AWOG, trong phần session tôi gặp lỗi 400 với nội dung: {"type":"error","error":{"message":"You're out of extra usage..."}}. Tôi kiểm tra thì tài khoản vẫn còn token. Hãy giải thích nguyên nhân gây ra lỗi này và hướng dẫn cách khắc phục để tiếp tục dùng được.`

// Known low-cost models per provider. Absent → use the session model only.
const CHEAP_MODEL: Partial<Record<ProviderName, string>> = {
  anthropic: 'claude-haiku-4-5',
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:[a-zA-Z]*)?\s*([\s\S]*?)\s*```$/)
  if (fenced && fenced[1]) return fenced[1].trim()
  return trimmed
}

register('sessions.enhancePrompt', async (raw) => {
  const params = Params.parse(raw)

  // Try the cheap model first, then the session's own model as a fallback.
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
        systemPrompt: ENHANCE_SYS,
        // Wrap the draft so the model treats it as text to rewrite, not as an
        // instruction to act on. Output stays "only the rewritten prompt".
        prompt: `Rewrite the prompt between the markers. Output only the rewritten prompt.\n\n<<<PROMPT\n${params.text}\nPROMPT>>>`,
      })
      const text = stripCodeFence(out)
      if (text) {
        log.info('sessions.enhancePrompt', { model: modelId, inChars: params.text.length })
        return { text }
      }
    } catch (err) {
      lastErr = err
      log.warn('sessions.enhancePrompt attempt failed', {
        model: modelId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  if (lastErr instanceof RpcError) throw lastErr
  throw new RpcError(-32021, 'Empty or failed response from model')
})
