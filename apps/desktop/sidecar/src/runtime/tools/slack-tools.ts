// Tool `slack_draft_reply` cho agent (docs/features/slack-threads.md, mục "Session
// theo thread").
//
// Phiên gắn với một thread Slack soạn được câu trả lời — nhưng KHÔNG gửi. Tool chỉ
// phát `slack.draft` để renderer đổ chữ vào ô trả lời của thread đó; người dùng đọc,
// sửa và tự bấm gửi. Cùng nguyên tắc "agent soạn, người đẩy" của ADR 0091: gửi lên
// Slack là nói thay người dùng với khách hàng, không thu hồi được (người nhận đã đọc
// thông báo), nên thao tác đó luôn cần một người bấm.
//
// Ba ràng buộc, mỗi cái là một quyết định:
//  1. KHÔNG có tool nào gửi / react / sửa / xoá trên Slack. Đừng thêm.
//  2. Thread đích suy từ PHIÊN (`thread.sessionId === sessionId`), không nhận
//     threadId từ model: một model bị prompt-injection từ chính nội dung thread không
//     thể chuyển nháp sang thread của khách khác.
//  3. Không đi qua thẻ duyệt quyền: tác dụng của tool chỉ là điền chữ vào một ô nhập
//     trên UI, người dùng vẫn phải đọc và bấm gửi. Hỏi duyệt trước khi điền nháp là
//     hỏi hai lần cho cùng một việc (cùng lý do `create_session` nhường cổng chung cho
//     popover). Luật DENY của người dùng vẫn chặn được như mọi tool khác.

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { emit } from '../../transport/stdio.js'
import { log } from '../../util/logger.js'
import { neutralizeDraftTokens } from '../../slack/mrkdwn.js'
import { listThreads } from '../../slack/store.js'
import type { SlackThread } from '../../slack/types.js'

// Tên server MCP in-process trên nhánh Claude SDK + danh sách tool, để bảng bắc cầu
// (tools/bridged.ts) DẪN XUẤT thay vì chép tay.
export const SLACK_MCP_SERVER = 'awogslack'
export const SLACK_DRAFT_TOOL_NAME = 'slack_draft_reply'
export const SLACK_TOOL_NAMES = [SLACK_DRAFT_TOOL_NAME] as const

// Trần độ dài nháp — rộng hơn mọi câu trả lời thread hợp lý, đủ hẹp để một model chạy
// lạc không đổ cả transcript vào composer.
export const MAX_DRAFT_LEN = 8000

export const SLACK_DRAFT_TEXT = {
  description:
    'Place a DRAFT reply in the Slack composer of the Slack thread linked to the current session. ' +
    'This does NOT send anything: the user reviews, edits and sends it themselves. ' +
    'There is no tool to send, react to, edit or delete Slack messages. ' +
    'Write the draft in Slack mrkdwn (*bold*, _italic_, `code`); mention people as <@USERID> only if you know their id. ' +
    'Do not use <!here>, <!channel>, <!everyone>, <!subteam^…> or <url|label> links: they are converted to plain text. ' +
    'Calling it again replaces the previous draft.',
  text: `The draft text, at most ${MAX_DRAFT_LEN} characters.`,
} as const

// Thread gắn với phiên, hoặc null. Đọc thẳng store mỗi lần gọi — file vài chục dòng,
// và người dùng có thể gỡ/đổi liên kết giữa hai lượt.
export async function findThreadForSession(sessionId: string): Promise<SlackThread | null> {
  return (await listThreads()).find((t) => t.sessionId === sessionId) ?? null
}

// Có thread nào gắn với phiên này không — điều kiện cấp tool (không gắn ⇒ không có
// schema nào trong lượt ⇒ không tốn token). Lỗi đọc store coi như "không".
export async function sessionHasSlackThread(sessionId: string | undefined): Promise<boolean> {
  if (!sessionId) return false
  try {
    return (await findThreadForSession(sessionId)) !== null
  } catch (err) {
    log.warn('slack: failed to read threads for tool gating', {
      err: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

// Handler dùng chung cho mọi runtime (Pi, Codex qua dynamicTools, Claude SDK qua MCP).
export async function runSlackDraftReply(
  sessionId: string | undefined,
  rawText: string,
): Promise<{ text: string; isError: boolean }> {
  const text = rawText.trim()
  if (!text) return { text: 'The draft is empty; nothing was placed.', isError: true }
  if (text.length > MAX_DRAFT_LEN) {
    return {
      text: `The draft is ${text.length} characters; the limit is ${MAX_DRAFT_LEN}. Write a shorter reply.`,
      isError: true,
    }
  }
  if (!sessionId) {
    return { text: 'This tool only works inside a chat session.', isError: true }
  }
  const thread = await findThreadForSession(sessionId)
  if (!thread) {
    return {
      text:
        'This session is not linked to a Slack thread, so there is no composer to put a draft in. ' +
        'Give the reply to the user in chat instead; they can link the thread from the Slack view ("Open session").',
      isError: true,
    }
  }
  // Lọc token ping-cả-kênh / link giả nhãn TRƯỚC khi chữ rời sidecar (slack/mrkdwn.ts).
  const safe = neutralizeDraftTokens(text)
  emit('slack.draft', { threadId: thread.id, text: safe })
  log.info('slack: draft placed in composer', { threadId: thread.id, chars: safe.length })
  return { text: 'Draft placed in the Slack composer; the user will review and send it.', isError: false }
}

const DraftParams = Type.Object({
  text: Type.String({ description: SLACK_DRAFT_TEXT.text, maxLength: MAX_DRAFT_LEN }),
})

export function createSlackTools(opts: { sessionId: string }): AgentTool[] {
  const draftTool: AgentTool<typeof DraftParams, { placed: boolean }> = {
    name: SLACK_DRAFT_TOOL_NAME,
    label: 'Slack draft reply',
    description: SLACK_DRAFT_TEXT.description,
    parameters: DraftParams,
    async execute(_id, params): Promise<AgentToolResult<{ placed: boolean }>> {
      const r = await runSlackDraftReply(opts.sessionId, params.text)
      return {
        content: [{ type: 'text', text: r.text }],
        details: { placed: !r.isError, ...(r.isError ? { isError: true } : {}) },
      }
    },
  }
  return [draftTool] as AgentTool[]
}
