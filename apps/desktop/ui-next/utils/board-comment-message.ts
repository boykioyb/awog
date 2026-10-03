// Comment của board item → SessionMessage để render trong SessionTranscript /
// gom vào media index: system (from=null + fromTitle 'system') → divider;
// user (from=null) → bubble phải; agent (from=sessionId) → assistant turn kèm
// `author` = title tác giả (đa tác giả: lead + các member trong một thread).
import type { BoardItemComment } from '~/stores/board'
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
