// slack.reply → đăng reply vào thread, do NGƯỜI bấm gửi (không có tool agent
// nào đi tới đây). `text` đã là mrkdwn — UI tự đổi chip mention thành `<@U…>`.
//
// KHÔNG retry ở bất kỳ tầng nào: `chat.postMessage` không idempotent, thử lại
// sau một lỗi mạng giữa chừng có thể đăng hai lần lên kênh của khách.
import { z } from 'zod'
import { TS_RE, ThreadIdSchema } from '../slack/params.js'
import { emitSlackChanged, registerSlack } from '../slack/rpc.js'
import { openSlackSession } from '../slack/session.js'
import { maxTs, mutateThread, requireThread } from '../slack/store.js'
import { SlackApiError } from '../slack/client.js'
import { log } from '../util/logger.js'

// Trần text của Slack cho một tin là 40k ký tự.
const Params = z.object({
  threadId: ThreadIdSchema,
  text: z.string().min(1).max(40_000),
  broadcast: z.boolean().optional(),
})

registerSlack('slack.reply', async (raw): Promise<{ ts: string }> => {
  const p = Params.parse(raw)
  if (!p.text.trim()) throw new SlackApiError('no_text', 'Reply is empty')
  const thread = await requireThread(p.threadId)
  const session = await openSlackSession(thread.sourceId)
  const data = await session.api(
    'chat.postMessage',
    {
      channel: thread.channelId,
      thread_ts: thread.threadTs,
      text: p.text,
      reply_broadcast: p.broadcast ? true : undefined,
    },
    { write: true },
  )
  const ts = typeof data.ts === 'string' && TS_RE.test(data.ts) ? data.ts : null
  if (!ts) throw new SlackApiError('bad_response', 'chat.postMessage returned no ts')
  // Tin ĐÃ lên Slack. Từ đây mọi lỗi (ghi sổ hỏng, thread vừa bị bỏ theo dõi ở cửa
  // sổ kia) chỉ log: ném lỗi lúc này làm UI tưởng chưa gửi, người dùng bấm lại và
  // tin đăng hai lần lên kênh khách. Sổ lệch thì vòng poll kế tiếp tự sửa.
  try {
    // Tin vừa gửi là tin mới nhất người dùng đã thấy — không tự bật chấm chưa đọc.
    await mutateThread(thread.id, (t) => ({
      ...t,
      lastReplyTs: maxTs(t.lastReplyTs, ts),
      lastSeenTs: maxTs(t.lastSeenTs, ts),
      replyCount: t.replyCount + 1,
    }))
    emitSlackChanged([thread.id])
  } catch (err) {
    log.warn('slack: reply posted but bookkeeping failed', {
      threadId: thread.id,
      err: err instanceof Error ? err.message : String(err),
    })
  }
  return { ts }
})
