// slack.directory.emoji → danh sách emoji tuỳ chỉnh của workspace cho picker: CHỈ
// tên + alias (`url` luôn null). Ảnh lấy theo lô qua slack.directory.emojiImages.
// Token thiếu `emoji:read` ⇒ `[]` (không lỗi); slack.status báo scope thiếu riêng.
import { z } from 'zod'
import { TeamIdSchema } from '../slack/params.js'
import { registerSlack } from '../slack/rpc.js'
import { listCustomEmoji } from '../slack/directory.js'
import { openSlackSessionForTeam } from '../slack/session.js'
import type { SlackEmoji } from '../slack/types.js'

const Params = z.object({ teamId: TeamIdSchema })

registerSlack('slack.directory.emoji', async (raw): Promise<{ emoji: SlackEmoji[] }> => {
  const p = Params.parse(raw)
  const session = await openSlackSessionForTeam(p.teamId)
  return { emoji: await listCustomEmoji(session) }
})
