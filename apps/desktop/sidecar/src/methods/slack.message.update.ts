// slack.message.update → sửa tin của CHÍNH người dùng trong thread. Kiểm chủ
// tin trước khi gọi `chat.update` (slack/threads.ts › assertOwnMessage). Ghi,
// nên không retry.
import { z } from 'zod'
import { ThreadIdSchema, TsSchema } from '../slack/params.js'
import { emitSlackChanged, registerSlack } from '../slack/rpc.js'
import { openSlackSession } from '../slack/session.js'
import { requireThread } from '../slack/store.js'
import { assertOwnMessage } from '../slack/threads.js'

const Params = z.object({
  threadId: ThreadIdSchema,
  ts: TsSchema,
  text: z.string().min(1).max(40_000),
})

registerSlack('slack.message.update', async (raw): Promise<{ ok: true }> => {
  const p = Params.parse(raw)
  const thread = await requireThread(p.threadId)
  const session = await openSlackSession(thread.sourceId)
  await assertOwnMessage(session, thread, p.ts)
  await session.api('chat.update', { channel: thread.channelId, ts: p.ts, text: p.text }, { write: true })
  emitSlackChanged([thread.id])
  return { ok: true }
})
