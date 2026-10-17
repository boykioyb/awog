// slack.directory.emojiImages → ảnh (data URI) cho một lô emoji tuỳ chỉnh, để
// picker chỉ tải phần đang hiện thay vì cả nghìn ảnh một lúc. Cache đĩa dùng
// chung với ảnh emoji trong thread (slack/directory.ts).
//
// BẢO MẬT: renderer chỉ gửi TÊN (qua EMOJI_RE); URL ảnh do sidecar tự tra trong
// `emoji.list`. Trần 64 tên/lô để một lời gọi không kéo cả workspace.
import { z } from 'zod'
import { EmojiNameSchema, TeamIdSchema } from '../slack/params.js'
import { registerSlack } from '../slack/rpc.js'
import { emojiImages } from '../slack/directory.js'
import { openSlackSessionForTeam } from '../slack/session.js'

const MAX_NAMES = 64

const Params = z.object({
  teamId: TeamIdSchema,
  names: z.array(EmojiNameSchema).max(MAX_NAMES),
})

registerSlack(
  'slack.directory.emojiImages',
  async (raw): Promise<{ images: Record<string, string> }> => {
    const p = Params.parse(raw)
    if (p.names.length === 0) return { images: {} }
    const session = await openSlackSessionForTeam(p.teamId)
    return { images: await emojiImages(session, p.names) }
  },
)
