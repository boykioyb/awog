// slack.reaction.add / slack.reaction.remove → thả/bỏ reaction lên một tin
// trong thread. Hai method chung một file vì chỉ khác tên method Slack và mã
// lỗi "đã ở trạng thái đó" được coi là thành công (bấm đúp chip, hai cửa sổ).
import { z } from 'zod'
import { SlackApiError } from '../slack/client.js'
import { EmojiNameSchema, ThreadIdSchema, TsSchema } from '../slack/params.js'
import { emitSlackChanged, registerSlack } from '../slack/rpc.js'
import { openSlackSession } from '../slack/session.js'
import { requireThread } from '../slack/store.js'

const Params = z.object({ threadId: ThreadIdSchema, ts: TsSchema, name: EmojiNameSchema })

function reactionHandler(method: 'reactions.add' | 'reactions.remove', idempotentCode: string) {
  return async (raw: unknown): Promise<{ ok: true }> => {
    const p = Params.parse(raw)
    const thread = await requireThread(p.threadId)
    const session = await openSlackSession(thread.sourceId)
    try {
      await session.api(
        method,
        { channel: thread.channelId, timestamp: p.ts, name: p.name },
        { write: true },
      )
    } catch (err) {
      if (!(err instanceof SlackApiError && err.code === idempotentCode)) throw err
    }
    emitSlackChanged([thread.id])
    return { ok: true }
  }
}

registerSlack('slack.reaction.add', reactionHandler('reactions.add', 'already_reacted'))
registerSlack('slack.reaction.remove', reactionHandler('reactions.remove', 'no_reaction'))
