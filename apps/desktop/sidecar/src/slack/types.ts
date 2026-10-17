// Hợp đồng dữ liệu Slack threads giữa sidecar và renderer.
//
// Đây là NGUỒN SỰ THẬT của type (docs/features/slack-threads.md, mục "Hợp đồng
// dữ liệu"); UI mirror bằng tay ở `apps/desktop/ui-next/stores/slack.ts`. Đổi
// một field ở đây thì phải đổi bên kia trong cùng lượt — không có codegen nào
// bắt lệch giữa hai bên.
//
// Mọi thứ trong file này đi ra RPC/event, nên KHÔNG được có token hay URL file
// riêng tư (`url_private…`) — những thứ đó chỉ sống trong sidecar.

export type SlackThreadError = 'not_found' | 'no_access'

export type SlackThread = {
  // `${teamId}:${channelId}:${threadTs}`
  id: string
  // id nguồn Slack trong Sources
  sourceId: string
  teamId: string
  teamName: string
  // https://malme.slack.com/
  teamUrl: string
  channelId: string
  // không có '#'
  channelName: string
  // ts tin gốc
  threadTs: string
  // tiêu đề người dùng đặt; null ⇒ UI lấy dòng đầu tin gốc
  title: string | null
  // dòng đầu tin gốc (đã bỏ mrkdwn), ≤120 ký tự
  firstLine: string
  projectId: string | null
  // engineId phiên gắn thread
  sessionId: string | null
  // reply mới nhất đã đưa vào phiên
  sessionSyncedTs: string | null
  // ts tin mới nhất trong thread
  lastReplyTs: string
  // ts tin mới nhất người dùng đã xem
  lastSeenTs: string
  replyCount: number
  addedAt: number
  // thread bị xoá / mất quyền kênh
  error: SlackThreadError | null
}

export type SlackFileKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'office'
  | 'text'
  | 'snippet'
  | 'other'

// 'external' = file liên kết từ dịch vụ ngoài (Google Drive, Dropbox…): Slack
// không giữ bytes, sidecar không tải/không thumbnail — UI chỉ mở `externalUrl`.
export type SlackFileUnavailable = 'deleted' | 'no_access' | 'too_large' | 'external'

export type SlackFile = {
  id: string
  name: string
  title: string
  mimetype: string
  filetype: string
  size: number
  kind: SlackFileKind
  // thumbnail sẵn có
  thumb: { size: 360 | 720; width: number; height: number } | null
  hasVideoPoster: boolean
  // snippet/post: nội dung text (≤20k ký tự)
  preview: string | null
  permalink: string
  unavailable: SlackFileUnavailable | null
  // Chỉ khác null khi `unavailable === 'external'` VÀ URL ngoài là `https:`.
  // Đây là link công khai người gửi tự dán, không phải URL file riêng tư.
  externalUrl: string | null
}

export type SlackReaction = { name: string; count: number; users: string[]; mine: boolean }

export type SlackUnfurl = {
  title: string | null
  text: string | null
  url: string | null
  serviceName: string | null
  imageUrl: string | null
}

export type SlackMessage = {
  ts: string
  // null cho bot
  userId: string | null
  botName: string | null
  // mrkdwn thô của Slack
  text: string
  editedTs: string | null
  reactions: SlackReaction[]
  files: SlackFile[]
  unfurls: SlackUnfurl[]
  isParent: boolean
  subtype: string | null
}

export type SlackUser = {
  id: string
  name: string
  displayName: string
  realName: string
  // data URI
  avatar: string | null
  isBot: boolean
  deleted: boolean
}

export type SlackEmoji = {
  name: string
  // data URI ảnh tuỳ chỉnh
  url: string | null
  alias: string | null
}

export type SlackThreadDetail = {
  thread: SlackThread
  // tin gốc trước, rồi reply theo thời gian
  messages: SlackMessage[]
  // mọi user xuất hiện (tác giả, mention, reaction)
  users: Record<string, SlackUser>
  selfUserId: string
  // id → name cho <#C…>
  channels: Record<string, string>
  // chỉ những emoji xuất hiện trong thread
  customEmoji: Record<string, SlackEmoji>
}

export type SlackStatusSource = {
  sourceId: string
  teamId: string | null
  teamName: string | null
  connected: boolean
  missingScopes: string[]
}

export type SlackStatus = {
  sources: SlackStatusSource[]
}

// Payload event `slack.changed` (sidecar → renderer).
export type SlackChangedEvent = { threadIds: string[] }

export const SLACK_CHANGED_EVENT = 'slack.changed'

export function threadIdOf(teamId: string, channelId: string, threadTs: string): string {
  return `${teamId}:${channelId}:${threadTs}`
}
