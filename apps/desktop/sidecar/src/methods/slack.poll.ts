// slack.poll → một vòng hỏi Slack thread nào có reply mới (slack/poll.ts).
// Renderer gọi theo nhịp riêng (thread đang mở 20s, còn lại 60s); vắng
// `threadIds` = mọi thread. Thread vừa poll < 15s bị bỏ qua để hai cửa sổ không
// hỏi dồn; `force: true` (người bấm làm mới) bỏ qua giới hạn đó. Có thay đổi thì
// poll tự phát `slack.changed`.
import { z } from 'zod'
import { ThreadIdSchema } from '../slack/params.js'
import { pollThreads } from '../slack/poll.js'
import { registerSlack } from '../slack/rpc.js'

const Params = z
  .object({
    threadIds: z.array(ThreadIdSchema).max(500).optional(),
    force: z.boolean().optional(),
  })
  .optional()

registerSlack('slack.poll', async (raw): Promise<{ changed: string[] }> => {
  const p = Params.parse(raw)
  return { changed: await pollThreads(p?.threadIds, { force: p?.force === true }) }
})
