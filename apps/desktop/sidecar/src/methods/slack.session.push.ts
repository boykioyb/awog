// slack.session.push → "Đưa vào session": giao phần reply mới (sau `sessionSyncedTs`)
// vào phiên đã gắn với thread, rồi dời mốc (docs/features/slack-threads.md). Chỉ chạy
// khi người dùng bấm — không có đường tự động nào gọi tới đây.
import { z } from 'zod'
import { ThreadIdSchema } from '../slack/params.js'
import { registerSlack } from '../slack/rpc.js'
import { pushThreadToSession, toSessionLinkRpcError } from '../slack/session-link.js'

const Params = z.object({ threadId: ThreadIdSchema })

registerSlack('slack.session.push', async (raw) => {
  const p = Params.parse(raw)
  try {
    return await pushThreadToSession(p.threadId)
  } catch (err) {
    throw toSessionLinkRpcError(err)
  }
})
