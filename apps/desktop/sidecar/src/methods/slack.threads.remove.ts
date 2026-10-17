// slack.threads.remove → thôi theo dõi một thread. Chỉ xoá khỏi danh sách;
// cache file/bản dịch của workspace để lại cho cơ chế dọn 30 ngày.
import { z } from 'zod'
import { ThreadIdSchema } from '../slack/params.js'
import { emitSlackChanged, registerSlack } from '../slack/rpc.js'
import { removeThread } from '../slack/store.js'

const Params = z.object({ threadId: ThreadIdSchema })

registerSlack('slack.threads.remove', async (raw): Promise<{ ok: true }> => {
  const { threadId } = Params.parse(raw)
  if (await removeThread(threadId)) emitSlackChanged([threadId])
  return { ok: true }
})
