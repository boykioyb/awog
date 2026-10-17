// Nối thread Slack với phiên AI: "Mở session" + "Đưa vào session"
// (docs/features/slack-threads.md, mục "Session theo thread").
//
// VÌ SAO LÀM Ở SIDECAR chứ không ở renderer: nút bấm có ở CẢ cửa sổ chính lẫn cửa sổ
// Slack riêng, mà cửa sổ Slack chỉ nhận event `slack.*` — nó không lái được phiên
// (không thấy `session.*` nên không theo dõi được lượt chạy). Sidecar thì nói được
// với cửa sổ chính bằng đúng hai event cửa sổ đó đã hiểu:
//   • `session.created`       — phiên mới hiện ngay trong danh sách (khuôn agents.run /
//                               spawn.ts), không phải gọi lại `sessions.list`;
//   • `session.inbox-message` — khối thread vào hàng đợi của phiên (khuôn pr-watch),
//                               renderer đang giữ phiên tự giao khi phiên rảnh.
// Một đường duy nhất cho cả hai cửa sổ; renderer chỉ còn việc focus phiên.
//
// KHÔNG tự wake: chỉ chạy khi người dùng bấm. Poll thấy reply mới thì chỉ bật chấm
// "có mới" (`hasNewForSession` ở UI), không đẩy gì vào phiên.

import { RpcError } from '../transport/rpc.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { loadProject } from '../projects/store.js'
import { createSession, flushSession, listSessionSummaries } from '../sessions/store.js'
import { mintSessionId } from '../sessions/spawn.js'
import type { InboxOrigin } from '../sessions/inbox.js'
import { listSources } from '../sources/store.js'
import type { Session, SessionSettings, SessionSummary } from '../types/shared.js'
import { serialize } from './json-file.js'
import { SLACK_RPC_CODE, emitSlackChanged } from './rpc.js'
import { isSlackSource } from './session.js'
import { mutateThread, requireThread } from './store.js'
import { ThreadUnavailableError, loadFullThreadDetail } from './thread.js'
import { markSessionSlackTainted } from './taint.js'
import { buildSlackThreadBlock, oneLine } from './thread-block.js'
import type { SlackThread } from './types.js'

// Nhãn một dòng cho chip/preview trên UI.
const MAX_PREVIEW_LEN = 120

export function threadLabel(t: SlackThread): string {
  return oneLine(t.title || t.firstLine || `#${t.channelName}`, MAX_PREVIEW_LEN)
}

// Mọi thao tác open/push của CÙNG một thread đi tuần tự và đọc lại thread BÊN TRONG
// khoá: bấm đúp "Mở session" (hoặc bấm ở cả hai cửa sổ) không được tạo hai phiên, và
// lần push thứ hai phải thấy mốc `sessionSyncedTs` lần đầu vừa ghi.
function withThreadLock<T>(threadId: string, task: () => Promise<T>): Promise<T> {
  return serialize(`slack-session-${threadId}`, task)
}

// Phiên còn dùng được: tồn tại và chưa lưu trữ. Đọc index header, không hydrate
// transcript.
async function liveSession(sessionId: string | null): Promise<SessionSummary | null> {
  if (!sessionId) return null
  const s = (await listSessionSummaries()).find((x) => x.id === sessionId)
  return s && !s.archived ? s : null
}

// Đặt khối vào hộp thư của phiên. Payload trùng khuôn sessions/inbox.ts + pr-watch để
// renderer không phải học hình dạng thứ hai. `origin: 'external'`: người dùng bấm nút
// nhưng CHỮ là của người ngoài — không được dán nhãn "user" (xem thread-block.ts).
//
// Ghi cờ nhiễm (taint.ts) TRƯỚC khi phát: ghi hỏng thì ném, khối không vào phiên —
// không có lúc nào phiên đã cầm chữ người ngoài mà chốt ở sendMessage chưa biết.
async function deliverBlock(sessionId: string, thread: SlackThread, block: string): Promise<void> {
  await markSessionSlackTainted(sessionId)
  const at = new Date().toISOString()
  emit('session.inbox-message', {
    sessionId,
    messageId: `slk-${thread.threadTs.replace('.', '')}-${Date.now()}`,
    origin: 'external' satisfies InboxOrigin,
    fromSessionId: null,
    fromTitle: `Slack · #${oneLine(thread.channelName, 80)}`,
    at,
    // Preview mở đầu bằng "Slack" vì chip chọn nhãn "từ ai" theo `fromSessionId`, mà
    // tin này không đến từ phiên nào — nguồn phải tự nói ra.
    preview: oneLine(`Slack · #${thread.channelName} · ${threadLabel(thread)}`, MAX_PREVIEW_LEN),
    block,
  })
}

// Whitelist MCP cho phiên tạo từ thread. Lấy đúng mặc định một phiên mới của
// project nhận ở UI (`llmDefaults.mcpServerIds`, vắng ⇒ không gắn nguồn nào) rồi
// LOẠI mọi nguồn Slack: lượt đầu của phiên là nội dung người ngoài viết, và tool
// MCP Slack (gửi tin, react…) là đường để một câu injection trong thread tự đăng
// lên kênh khách mà người dùng không bấm gì. Danh sách TƯỜNG MINH (không để
// `undefined`): `undefined` nghĩa là "mọi nguồn đang bật", gồm cả nguồn Slack.
async function threadSessionMcpWhitelist(projectId: string | null): Promise<string[]> {
  const project = projectId ? await loadProject(projectId) : null
  const base = project?.llmDefaults?.mcpServerIds ?? []
  if (base.length === 0) return []
  const slackIds = new Set((await listSources()).filter(isSlackSource).map((s) => s.id))
  return base.filter((id) => !slackIds.has(id))
}

async function setSyncedTs(threadId: string, syncedTs: string): Promise<SlackThread> {
  return mutateThread(threadId, (t) => ({ ...t, sessionSyncedTs: syncedTs }))
}

export interface OpenThreadSessionResult {
  sessionId: string
  created: boolean
  thread: SlackThread
}

// Phiên đã gắn và còn sống ⇒ trả lại nó (không gửi gì thêm — muốn đưa reply mới thì
// bấm "Đưa vào session"). Không ⇒ tạo phiên mới theo project của thread.
//
// Thứ tự: tạo phiên → gắn `sessionId` (mốc đồng bộ = null) → giao khối → RỒI mới
// ghi `sessionSyncedTs`. Gắn phiên trước vì lượt đầu phải thấy tool nháp Slack (tool
// chỉ cấp khi phiên có thread gắn — và Codex chốt danh sách tool ở lượt đầu). Mốc
// ghi sau cùng vì nó nghĩa là "đã giao tới đây": lỗi giữa chừng mà mốc đã dời thì
// lần "Đưa vào session" sau bỏ sót đúng phần chưa giao. (Sidecar không biết cửa sổ
// nào nhận event — UI tự đảm bảo cửa sổ chính sẵn sàng trước khi gọi RPC này.)
export function openThreadSession(
  threadId: string,
  settings: SessionSettings,
): Promise<OpenThreadSessionResult> {
  return withThreadLock(threadId, async () => {
    const thread = await requireThread(threadId)
    if (thread.sessionId && (await liveSession(thread.sessionId))) {
      return { sessionId: thread.sessionId, created: false, thread }
    }

    // Lấy nội dung TRƯỚC khi tạo phiên: Slack lỗi (mất token, mất quyền kênh) thì
    // không để lại một phiên rỗng mồ côi trong danh sách.
    const detail = await loadFullThreadDetail(threadId)
    const { text, lastTs } = buildSlackThreadBlock(detail)
    const mcpServerIds = await threadSessionMcpWhitelist(thread.projectId)

    const now = new Date().toISOString()
    const sessionId = mintSessionId()
    const title = `Slack: ${threadLabel(thread)}`
    const session: Session = {
      id: sessionId,
      title,
      projectId: thread.projectId,
      createdAt: now,
      updatedAt: now,
      invitedAgentIds: [],
      messages: [],
      pendingAgentIds: [],
      settings,
      mcpServerIds,
    }
    await createSession(session)
    const summary: SessionSummary = {
      id: sessionId,
      title,
      projectId: thread.projectId,
      createdAt: now,
      updatedAt: now,
      status: 'idle',
      invitedAgentIds: [],
      pendingAgentIds: [],
      settings,
      mcpServerIds,
      messageCount: 0,
    }
    // `session.created` PHẢI đi trước tin hộp thư: renderer chỉ tự giao khi tìm thấy
    // phiên đích trong store (cùng lý do spawn.ts). Hai event đi chung một kênh stdio
    // theo thứ tự nên phát trước là đủ.
    emit('session.created', { session: summary })
    await flushSession(sessionId)

    try {
      const attached = await mutateThread(threadId, (t) => ({
        ...t,
        sessionId,
        sessionSyncedTs: null,
      }))
      await deliverBlock(sessionId, attached, text)
      const linked = await setSyncedTs(threadId, lastTs)
      log.info('slack: session opened for thread', { threadId, sessionId })
      return { sessionId, created: true, thread: linked }
    } finally {
      // Kể cả khi hỏng giữa chừng: thread đã đổi `sessionId` thì cửa sổ kia phải biết.
      emitSlackChanged([threadId])
    }
  })
}

export class ThreadSessionMissingError extends Error {
  constructor(threadId: string) {
    super(`Slack thread ${threadId} has no live session; open one first`)
    this.name = 'ThreadSessionMissingError'
  }
}

export interface PushThreadResult {
  // false = không có tin nào sau mốc đã đồng bộ ⇒ không giao gì.
  pushed: boolean
  thread: SlackThread
}

// Đưa phần reply MỚI (sau `sessionSyncedTs`) vào phiên đã gắn: giao xong mới dời mốc.
export function pushThreadToSession(threadId: string): Promise<PushThreadResult> {
  return withThreadLock(threadId, async () => {
    const thread = await requireThread(threadId)
    const session = await liveSession(thread.sessionId)
    if (!session) throw new ThreadSessionMissingError(threadId)

    const detail = await loadFullThreadDetail(threadId)
    const { text, lastTs } = buildSlackThreadBlock(detail, thread.sessionSyncedTs)
    if (thread.sessionSyncedTs && lastTs === thread.sessionSyncedTs) {
      return { pushed: false, thread }
    }
    await deliverBlock(session.id, thread, text)
    const linked = await setSyncedTs(threadId, lastTs)
    emitSlackChanged([threadId])
    log.info('slack: new replies pushed to session', { threadId, sessionId: session.id })
    return { pushed: true, thread: linked }
  })
}

// Lỗi riêng của lớp nối phiên → RpcError cùng mã SLACK_RPC_CODE + `slackCode` như mọi
// lỗi `slack.*` (slack/rpc.ts), để UI rẽ nhánh theo mã chứ không theo câu chữ. Lỗi khác
// để `registerSlack` dịch tiếp.
export function toSessionLinkRpcError(err: unknown): unknown {
  if (err instanceof ThreadSessionMissingError) {
    return new RpcError(SLACK_RPC_CODE, err.message, { slackCode: 'session_missing' })
  }
  if (err instanceof ThreadUnavailableError) {
    return new RpcError(SLACK_RPC_CODE, err.message, { slackCode: 'thread_unavailable' })
  }
  return err
}
