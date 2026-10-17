// slack.status → các nguồn Slack, đã kết nối chưa, thiếu scope nào
// (docs/features/slack-threads.md). Hỏi `auth.test` mới mỗi lần để header
// `x-oauth-scopes` phản ánh đúng lúc người dùng vừa kết nối lại nguồn. Token
// hết hạn không có refresh token ⇒ `connected: false`, UI hiện banner.
import { registerSlack } from '../slack/rpc.js'
import { missingScopes, probeSources } from '../slack/session.js'
import type { SlackStatus } from '../slack/types.js'

registerSlack('slack.status', async (): Promise<SlackStatus> => {
  const probes = await probeSources()
  return {
    sources: probes.map((p) => ({
      sourceId: p.source.id,
      teamId: p.identity?.teamId ?? null,
      teamName: p.identity?.teamName ?? null,
      connected: p.connected,
      missingScopes: p.connected ? missingScopes(p.identity?.scopes ?? null) : [],
    })),
  }
})
