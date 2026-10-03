// boards.draft — one-shot LLM dựng title + desc cho một board item từ brief
// ngắn của người dùng (nút "Dựng bằng AI" trong WorkspaceBoardEditor, mode
// manual). Khuôn teams.draft: model trả MỘT JSON object, sidecar sanitize theo
// trần boards.upsert — draft không ghi đĩa, người dùng duyệt rồi mới Lưu.
//
// Model/account do UI truyền (`settings`) — cùng một cấu hình "AI authoring"
// của Settings → Models với teams.draft/agents.generate.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import { completePi } from '../runtime/complete.js'
import { MAX_TEXT_LEN, oneLineLabel } from '../sessions/inbox.js'
import type { ProviderName } from '../types/shared.js'

const Params = z.object({
  projectId: z.string().min(1).max(64),
  brief: z.string().min(1).max(MAX_TEXT_LEN),
  // Có mặt ⇒ revise title/desc đang có; vắng mặt ⇒ draft mới.
  current: z
    .object({
      title: z.string().max(240).optional(),
      desc: z.string().max(8000).optional(),
    })
    .optional(),
  settings: z.object({
    provider: z.enum(['anthropic', 'openai', 'google']),
    modelId: z.string().min(1).max(200),
    accountId: z.string().max(64).optional(),
  }),
})

// Trần khớp boards.upsert (MAX_ITEM_TITLE_LEN nằm ở boards/store — giữ 200/8000
// như UI maxlength để draft không trả text dài hơn ô nhận).
const MAX_TITLE = 200
const MAX_DESC = 8000

const SYS = `You draft board items for AWOG, a local-first AI team OS. A board item is a task card on a project kanban (title + markdown description) that a human or an agent session executes.

Output ONLY a JSON object — no prose, no markdown fence:
{"title": "…", "desc": "…"}

Rules:
- title: max 200 chars, one line, imperative and specific (e.g. "Fix OAuth refresh token rotation").
- GitHub convention: when the request centers on one specific GitHub issue/PR (a github.com/<org>/<repo>/(issues|pull)/<n> link or an explicit "#<n> issue/PR" reference), the title MUST be "#<n>_IS: <short desc>" for an issue or "#<n>_PR: <short desc>" for a pull request.
- desc: markdown body — context, acceptance criteria bullet list, edge cases worth noting. Omit when the request adds nothing beyond the title.
- When a CURRENT item is provided, revise it per the request — keep what isn't mentioned.
- Match the language of the request.`

// Cheap-per-provider (mirror sessions.spawn.ts) — không có bản rẻ thì thử
// thẳng model người dùng đang chọn.
const CHEAP_MODEL: Partial<Record<ProviderName, string>> = {
  anthropic: 'claude-haiku-4-5',
}

register('boards.draft', async (raw) => {
  const params = Params.parse(raw)

  const body = [
    `Request: ${params.brief.trim()}`,
    params.current
      ? `\nCURRENT item (revise it, keep unmentioned parts):\n${JSON.stringify(params.current)}`
      : '',
    params.current ? 'Revise the item now.' : 'Draft the item now.',
  ]
    .filter(Boolean)
    .join('\n')

  const cheap = CHEAP_MODEL[params.settings.provider]
  const candidates =
    cheap && cheap !== params.settings.modelId
      ? [cheap, params.settings.modelId]
      : [params.settings.modelId]
  let lastErr = ''
  let out = ''
  for (const modelId of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop -- intentional sequential fallback
      out = await completePi({
        provider: params.settings.provider,
        ...(params.settings.accountId ? { accountId: params.settings.accountId } : {}),
        modelId,
        systemPrompt: SYS,
        prompt: body,
      })
      if (out.trim()) break
      lastErr = 'empty response'
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
      log.warn('boards.draft attempt failed', { model: modelId, err: lastErr })
    }
  }
  if (!out.trim()) {
    // Surface the underlying cause (expired credential, quota, …) — xem
    // teams.draft: "produced no draft" trần trụi che mất lỗi auth.
    throw new RpcError(-32021, `boards.draft: model produced no draft${lastErr ? ` — ${lastErr}` : ''}`)
  }

  // Bóc JSON object (chịu prose quanh) rồi sanitize theo trần upsert.
  const start = out.indexOf('{')
  const end = out.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new RpcError(-32021, 'boards.draft: could not parse model output')
  }
  let obj: { title?: unknown; desc?: unknown }
  try {
    obj = JSON.parse(out.slice(start, end + 1)) as { title?: unknown; desc?: unknown }
  } catch {
    throw new RpcError(-32021, 'boards.draft: could not parse model output')
  }
  const title = oneLineLabel(String(obj.title ?? ''), MAX_TITLE)
  if (!title) throw new RpcError(-32021, 'boards.draft: model returned no title')
  const desc = typeof obj.desc === 'string' ? obj.desc.trim().slice(0, MAX_DESC) : ''
  return { draft: { title, ...(desc ? { desc } : {}) } }
})
