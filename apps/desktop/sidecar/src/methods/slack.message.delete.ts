// slack.message.delete → xoá tin của CHÍNH người dùng trong thread. Kiểm chủ
// tin trước khi gọi `chat.delete`: token user của người có quyền admin xoá được
// tin người khác, và nút xoá trong AWOG không được thành đường làm việc đó.
import { z } from 'zod'
import { ThreadIdSchema, TsSchema } from '../slack/params.js'
import { emitSlackChanged, registerSlack } from '../slack/rpc.js'
import { openSlackSession } from '../slack/session.js'
import { requireThread } from '../slack/store.js'
import { assertOwnMessage } from '../slack/threads.js'

const Params = z.object({ threadId: ThreadIdSchema, ts: TsSchema })

registerSlack('slack.message.delete', async (raw): Promise<{ ok: true }> => {
  const p = Params.parse(raw)
  const thread = await requireThread(p.threadId)
  const session = await openSlackSession(thread.sourceId)
  await assertOwnMessage(session, thread, p.ts)
  await session.api('chat.delete', { channel: thread.channelId, ts: p.ts }, { write: true })
  emitSlackChanged([thread.id])
  return { ok: true }
})
