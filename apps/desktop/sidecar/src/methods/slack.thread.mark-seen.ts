// slack.thread.markSeen → ghi mốc "đã xem tới tin này" (tắt chấm chưa đọc).
// Chỉ tiến, không lùi: hai cửa sổ cùng mở một thread có thể gửi lệch nhịp, mốc
// lùi sẽ bật lại chấm chưa đọc cho tin người dùng đã xem.
import { z } from 'zod'
import { ThreadIdSchema, TsSchema } from '../slack/params.js'
import { emitSlackChanged, registerSlack } from '../slack/rpc.js'
import { maxTs, mutateThread } from '../slack/store.js'
import type { SlackThread } from '../slack/types.js'

const Params = z.object({ threadId: ThreadIdSchema, ts: TsSchema })

registerSlack('slack.thread.markSeen', async (raw): Promise<{ thread: SlackThread }> => {
  const p = Params.parse(raw)
  let changed = false
  const thread = await mutateThread(p.threadId, (t) => {
    const lastSeenTs = maxTs(t.lastSeenTs, p.ts)
    if (lastSeenTs === t.lastSeenTs) return null
    changed = true
    return { ...t, lastSeenTs }
  })
  if (changed) emitSlackChanged([thread.id])
  return { thread }
})
