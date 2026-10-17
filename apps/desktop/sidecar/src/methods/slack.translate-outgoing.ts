// slack.translateOutgoing → dịch bản nháp trả lời (thường sang tiếng Nhật) để
// người dùng xem trước rồi mới gửi. Không cache: nháp đổi liên tục, cache chỉ
// phình. Mention/emoji/link giữ nguyên như chiều đọc.
import { z } from 'zod'
import { ProviderSchema } from '../slack/params.js'
import { registerSlack } from '../slack/rpc.js'
import { TargetLangSchema, translateSlackText } from '../slack/translate.js'

const Params = z.object({
  text: z.string().min(1).max(40_000),
  targetLang: TargetLangSchema,
  provider: ProviderSchema,
  modelId: z.string().min(1).max(200),
  accountId: z.string().max(200).optional(),
})

registerSlack('slack.translateOutgoing', async (raw): Promise<{ text: string }> => {
  const p = Params.parse(raw)
  const text = await translateSlackText(p.text, p.targetLang, {
    provider: p.provider,
    modelId: p.modelId,
    ...(p.accountId ? { accountId: p.accountId } : {}),
  }, 'outgoing')
  return { text }
})
