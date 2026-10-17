// slack.threads.add → thêm thread từ permalink. URL duy nhất renderer được gửi
// lên trong cả tính năng, và nó chỉ được PARSE (permalink.ts) — sidecar không
// bao giờ fetch URL đó; nó chỉ lấy channel + ts rồi tự gọi Slack API.
import { z } from 'zod'
import { OpaqueIdSchema } from '../slack/params.js'
import { emitSlackChanged, registerSlack } from '../slack/rpc.js'
import { addThreadFromLink } from '../slack/threads.js'
import type { SlackThread } from '../slack/types.js'

const Params = z.object({
  url: z.string().min(1).max(2000),
  projectId: OpaqueIdSchema.optional(),
})

registerSlack('slack.threads.add', async (raw): Promise<{ thread: SlackThread }> => {
  const p = Params.parse(raw)
  const { thread, created } = await addThreadFromLink(p.url, p.projectId ?? null)
  if (created) emitSlackChanged([thread.id])
  return { thread }
})
