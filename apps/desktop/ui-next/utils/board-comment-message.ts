// Comment của board item → SessionMessage để render trong SessionTranscript /
// gom vào media index: system (from=null + fromTitle 'system') → divider;
// user (from=null) → bubble phải; agent (from=sessionId) → assistant turn kèm
// `author` = title tác giả (đa tác giả: lead + các member trong một thread).
import type { BoardItemComment, TeamChannelEntry } from '~/stores/board'
import type { SessionMessage } from '~/composables/useSessionsData'

export const isSystemBoardComment = (c: BoardItemComment): boolean =>
  c.from === null && c.fromTitle === 'system'

export function boardCommentToMessage(c: BoardItemComment): SessionMessage {
  if (isSystemBoardComment(c)) return { role: 'system', text: c.text, at: c.at }
  if (!c.from) return { role: 'user', text: c.text, at: c.at }
  return {
    role: 'assistant',
    blocks: [{ kind: 'text', text: c.text }],
    at: c.at,
    author: c.fromTitle,
  }
}

// Entry của kênh ê-kíp (member↔member) → SessionMessage cho tab Channel của
// item modal — cùng hình thức messenger của thread comment: tin broadcast của
// user (from=null) → bubble phải; member → assistant turn byline = title;
// system → vạch chia. `kindTag` (đã dịch) nối vào byline để phân biệt tin
// trạng-thái/đánh-giá/ghi-chú với chat thường ('' với kind chat).
export function channelEntryToMessage(e: TeamChannelEntry, kindTag: string): SessionMessage {
  if (e.kind === 'system') return { role: 'system', text: e.text, at: e.at }
  if (!e.from) return { role: 'user', text: e.text, at: e.at }
  return {
    role: 'assistant',
    blocks: [{ kind: 'text', text: e.text }],
    at: e.at,
    author: kindTag ? `${e.fromTitle} · ${kindTag}` : e.fromTitle,
  }
}
