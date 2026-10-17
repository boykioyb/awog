// slack.directory.users → gợi ý `@user` cho ô soạn (≤20, thành viên kênh xếp
// trước). Lần đầu mỗi 6 giờ phải kéo `users.list` cả workspace; sau đó tìm
// trong cache (slack/directory.ts).
import { z } from 'zod'
import { ChannelIdSchema, TeamIdSchema } from '../slack/params.js'
import { registerSlack } from '../slack/rpc.js'
import { searchUsers } from '../slack/directory.js'
import { openSlackSessionForTeam } from '../slack/session.js'
import type { SlackUser } from '../slack/types.js'

const Params = z.object({
  teamId: TeamIdSchema,
  query: z.string().max(100).optional(),
  channelId: ChannelIdSchema.optional(),
})

registerSlack('slack.directory.users', async (raw): Promise<{ users: SlackUser[] }> => {
  const p = Params.parse(raw)
  const session = await openSlackSessionForTeam(p.teamId)
  return { users: await searchUsers(session, p.query, p.channelId) }
})
