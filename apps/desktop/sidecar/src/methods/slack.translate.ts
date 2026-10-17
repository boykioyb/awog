// slack.translate → dịch các tin của một thread, có cache theo
// `ts:editedTs:lang:sha1(text)` (slack/translate.ts). Tin đã có trong cache trả ngay; còn
// lại gọi model rẻ (`preferCheap`) tối đa 3 song song.
import { z } from 'zod'
import { ProviderSchema, ThreadIdSchema, TsSchema, splitThreadId } from '../slack/params.js'
import { registerSlack } from '../slack/rpc.js'
import { requireThread } from '../slack/store.js'
import { TargetLangSchema, translateItems } from '../slack/translate.js'

const Params = z.object({
  threadId: ThreadIdSchema,
  items: z
    .array(
      z.object({
        ts: TsSchema,
        editedTs: TsSchema.nullable(),
        text: z.string().max(40_000),
      }),
    )
    .max(500),
  targetLang: TargetLangSchema,
  provider: ProviderSchema,
  modelId: z.string().min(1).max(200),
  accountId: z.string().max(200).optional(),
})

registerSlack('slack.translate', async (raw): Promise<{ texts: Record<string, string> }> => {
  const p = Params.parse(raw)
  await requireThread(p.threadId)
  const teamId = splitThreadId(p.threadId)?.teamId
  if (!teamId) throw new Error('invalid thread id')
  const texts = await translateItems(teamId, p.items, p.targetLang, {
    provider: p.provider,
    modelId: p.modelId,
    ...(p.accountId ? { accountId: p.accountId } : {}),
  })
  return { texts }
})
