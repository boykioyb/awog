// slack.session.open → "Mở session" cho một thread Slack (docs/features/slack-threads.md).
// Phiên gắn còn sống ⇒ trả lại nó; không ⇒ sidecar tạo phiên mới theo project của
// thread, gắn thread rồi giao khối thread làm tin đầu. Vì sao làm ở sidecar: xem
// slack/session-link.ts.
//
// BẢO MẬT: `settings` do renderer cấp (defaults của project/global — cùng
// `dispatchRunSettings` mà agents.run nhận) nên đi qua schema chặt, pick đúng field.
// Phiên này KHÔNG chạy ở mode tự duyệt (`execute` — mọi tool, `accept-edits` — sửa
// file): nội dung thread do NGƯỜI NGOÀI viết (khách, bot), một câu injection trong đó
// không được chạy lệnh/sửa file mà người dùng chưa duyệt. Renderer xin hai mode đó
// (hoặc không gửi) ⇒ `ask`. Đây chỉ là giá trị lưu cho phiên; chốt thật nằm ở
// `sessions.sendMessage`, kẹp lại MỌI lượt cho phiên đã nhiễm Slack (slack/taint.ts).
// Nguồn MCP Slack cũng bị loại khỏi phiên (slack/session-link.ts).
import { z } from 'zod'
import { ThreadIdSchema } from '../slack/params.js'
import { registerSlack } from '../slack/rpc.js'
import { openThreadSession, toSessionLinkRpcError } from '../slack/session-link.js'
import type { AgentMode, SessionSettings } from '../types/shared.js'

const SettingsSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']),
  modelId: z.string().min(1).max(200),
  level: z.enum(['low', 'medium', 'high', 'extra-high', 'max']).optional(),
  mode: z.enum(['ask', 'accept-edits', 'plan', 'execute']).optional(),
  accountId: z.string().max(64).optional(),
})

const Params = z.object({
  threadId: ThreadIdSchema,
  settings: SettingsSchema,
})

// Mức suy luận: cùng mặc định với agents.run khi renderer không gửi.
const LEVEL_DEFAULT = 'high' as const
// Mode: KHÁC agents.run (`execute`) — xem lý do ở đầu file.
const MODE_DEFAULT = 'ask' as const

function threadSessionMode(requested: AgentMode | undefined): AgentMode {
  if (!requested || requested === 'execute' || requested === 'accept-edits') return MODE_DEFAULT
  return requested
}

registerSlack('slack.session.open', async (raw) => {
  const p = Params.parse(raw)
  const settings: SessionSettings = {
    provider: p.settings.provider,
    modelId: p.settings.modelId,
    level: p.settings.level ?? LEVEL_DEFAULT,
    mode: threadSessionMode(p.settings.mode),
    ...(p.settings.accountId ? { accountId: p.settings.accountId } : {}),
  }
  try {
    const r = await openThreadSession(p.threadId, settings)
    return { sessionId: r.sessionId, created: r.created, thread: r.thread }
  } catch (err) {
    throw toSessionLinkRpcError(err)
  }
})
