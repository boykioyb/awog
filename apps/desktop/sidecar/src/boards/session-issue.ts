// Phiên ↔ issue (docs/features/session-issue-tracking.md): mỗi phiên có project
// là MỘT người thực thi của một issue trên board — đúng như một team run hay chính
// người dùng. Khác nhau chỉ ở người làm, nên board là nơi duy nhất trả lời "việc
// nào đang làm / tạm gác / bị chặn / xong".
//
// Liên kết nằm trên PHIÊN (`Session.issueId`); chiều ngược (issue → các phiên đã
// làm nó) suy ra bằng cách lọc phiên theo field đó, không lưu trên item — cùng
// khuôn aboutTaskId của ADR 0055. `item.assigneeSessionId` vẫn là "ai đang cầm"
// như cũ, nên team/agent nhận lại issue thì phiên cũ vẫn nằm trong lịch sử.
//
// Mọi hàm ở đây là best-effort trọn vẹn: board là phần CỘNG THÊM của một lượt
// chat, không bao giờ là điều kiện để chat — lỗi chỉ được log, không ném.

import {
  BoardError,
  addBoardItemComment,
  deleteBoardItemIf,
  getBoardItem,
  upsertBoardItem,
  MAX_ITEM_DESC_LEN,
  MAX_ITEM_TITLE_LEN,
} from './store.js'
import { listSessionSummaries, loadSession, setSessionIssue } from '../sessions/store.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import type { BoardItem, BoardItemStatus, Session, SessionSummary } from '../types/shared.js'

// Title giữ chỗ của phiên mới bên renderer (stores/sessions.ts create()) — chưa
// phải tên việc, nên issue lấy dòng đầu của prompt thay vào chờ auto-title.
const PLACEHOLDER_TITLE = 'New session'

// Trạng thái "chưa chạy" — phiên làm issue bắt đầu một lượt thì kéo về
// in_progress. blocked/in_review/done/cancelled đứng yên: đó là quyết định có chủ
// đích của người hoặc agent, một câu hỏi thêm trong phiên không lật được nó.
const RESUME_FROM: ReadonlySet<BoardItemStatus> = new Set(['backlog', 'todo', 'pending', 'changes'])

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

// Phiên nào tự sinh issue: có project (board là theo project), không thuộc team run
// (team đã có board riêng của nó qua team_item_*), không phải phiên board dispatch
// (nó đã LÀ người nhận của một item), và người dùng chưa bỏ theo dõi.
export function isIssueTrackable(
  s: Pick<SessionSummary, 'projectId' | 'teamRunId' | 'teamId' | 'origin' | 'issueUntracked'>,
): boolean {
  return !!s.projectId && !s.teamRunId && !s.teamId && s.origin !== 'board' && !s.issueUntracked
}

// Phiên `s` có đang TỰ làm issue `itemId` không — tức là phiên người dùng ngồi lái
// cho chính issue đó. Mọi đường board có thể đánh thức/đổi cấu hình một phiên
// (boards.upsert, boards.comment, tool team_item_*) phải hỏi hàm này trước: wake
// phiên đó là tự bắn một lượt model, route model là ghi đè llmOverride người dùng
// chọn. Một nguồn cho mọi đường.
export function tracksIssue(s: Pick<SessionSummary, 'issueId'> | undefined, itemId: string): boolean {
  return !!s && s.issueId === itemId
}

function initialTitle(session: Session, promptText: string): string {
  if (session.title && session.title !== PLACEHOLDER_TITLE) return session.title
  const firstLine = promptText
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  return (firstLine ?? PLACEHOLDER_TITLE).slice(0, MAX_ITEM_TITLE_LEN)
}

// Mô tả khởi đầu của issue tự sinh = nguyên tin nhắn đầu (không gọi model — có ngay,
// không tốn token). Cắt chừa biên dưới trần của store (redact có thể đổi độ dài).
function initialDesc(promptText: string): string {
  const text = promptText.trim()
  const max = MAX_ITEM_DESC_LEN - 100
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// Các phiên đã làm issue (trỏ issueId về nó, cộng người đang cầm) — mới hoạt động
// nhất trước, hydrate đủ transcript. Nguồn chung của recap và "viết mô tả bằng AI".
export async function issueExecutorSessions(item: BoardItem, max: number): Promise<Session[]> {
  const summaries = await listSessionSummaries()
  const ids = summaries
    .filter((s) => s.issueId === item.id || s.id === item.assigneeSessionId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, max)
    .map((s) => s.id)
  const out: Session[] = []
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop -- tuần tự: mỗi phiên hydrate một transcript
    const s = await loadSession(id)
    if (s) out.push(s)
  }
  return out
}

function emitSessionIssue(sessionId: string, issueId: string | null, untracked?: boolean): void {
  emit('session.issue', {
    sessionId,
    issueId,
    ...(untracked !== undefined ? { issueUntracked: untracked } : {}),
  })
}

// Issue TỰ SINH của chính phiên `sessionId` mà chưa ai đụng vào: không mô tả, không
// recap, không việc con, không trao đổi (chỉ vạch hệ thống), không ai khác cầm. Đây
// là loại issue được phép XOÁ khi phiên bỏ theo dõi hoặc bị xoá — một phiên hỏi vặt
// không được để lại rác trên board. Comment hệ thống nhận bằng from=null + 'system'
// (một PHIÊN tên "system" thì from là sessionId, không lọt).
function isBlankAutoIssue(item: BoardItem, all: readonly BoardItem[], sessionId: string): boolean {
  return (
    item.originSessionId === sessionId &&
    // Mô tả còn là tin nhắn đầu tự chép (autoDesc) thì vẫn tính là "chưa ai đụng".
    (!item.desc || item.autoDesc === true) &&
    !item.recap &&
    !all.some((i) => i.parentId === item.id) &&
    item.comments.every((c) => c.from === null && c.fromTitle === 'system') &&
    (!item.assigneeSessionId || item.assigneeSessionId === sessionId)
  )
}

async function otherExecutors(sessionId: string, projectId: string, issueId: string): Promise<boolean> {
  return (await listSessionSummaries()).some(
    (s) => s.id !== sessionId && s.issueId === issueId && s.projectId === projectId,
  )
}

// Phiên RỜI issue mà issue ở lại (xoá phiên / đổi project / bỏ theo dõi / gắn sang
// issue khác): issue phải hết "đang làm" thay vì kẹt mãi trong nhóm "Đang làm":
//   • gỡ assignee nếu đúng là phiên này — không thì `tracksIssue` không còn che nó và
//     comment/kéo cột sau này sẽ wake + route đè model của một phiên đã rời việc;
//   • không còn phiên nào khác làm ⇒ in_progress lùi về pending.
// Ghi một vạch hệ thống `note` để timeline thấy chuyện gì xảy ra.
async function releaseIssue(sessionId: string, projectId: string, issueId: string, note: string): Promise<void> {
  const item = await getBoardItem(projectId, issueId)
  if (!item) return
  const others = await otherExecutors(sessionId, projectId, issueId)
  const held = item.assigneeSessionId === sessionId
  const pause = item.status === 'in_progress' && !others && (held || !item.assigneeSessionId)
  if (held || pause) {
    await upsertBoardItem(projectId, {
      id: item.id,
      ...(held ? { assigneeSessionId: null } : {}),
      ...(pause ? { status: 'pending' as const } : {}),
    })
  }
  await addBoardItemComment(projectId, item.id, {
    from: null,
    fromTitle: 'system',
    text: note + (pause ? ' · in_progress → pending' : ''),
  })
}

// Xoá issue nếu nó là issue tự sinh còn trắng của phiên này (kiểm TRONG khoá ghi,
// xem deleteBoardItemIf) và không phiên nào khác làm nó. Trả id đã xoá.
async function deleteIfBlank(sessionId: string, projectId: string, issueId: string): Promise<string | undefined> {
  if (await otherExecutors(sessionId, projectId, issueId)) return undefined
  const deleted = await deleteBoardItemIf(projectId, issueId, (item, all) => isBlankAutoIssue(item, all, sessionId))
  return deleted?.id
}

// Gọi đầu mỗi lượt do NGƯỜI DÙNG gửi (không gọi cho lượt wake/kênh/lịch/lệnh CLI):
//   • phiên chưa có issue + trackable ⇒ tạo issue in_progress, phiên là assignee;
//   • phiên đã có issue đang ở trạng thái chưa chạy ⇒ kéo về in_progress + ghi
//     một system comment để timeline của issue thấy "làm lại lúc nào, ở phiên nào";
//   • issue đang in_progress mà không ai cầm (phiên cùng làm vừa bị xoá) ⇒ nhận lại;
//   • link trỏ vào issue đã biến mất (sửa tay file board…) ⇒ gỡ link rồi sinh mới.
// Chạy TRƯỚC khi dựng toolset/context của lượt nên tool board và <linked_issue>
// của chính lượt này đã thấy issue.
export async function onSessionTurnStart(sessionId: string, promptText: string): Promise<void> {
  try {
    const session = await loadSession(sessionId)
    if (!session?.projectId) return
    const projectId = session.projectId

    if (session.issueId) {
      const item = await getBoardItem(projectId, session.issueId)
      if (item) {
        if (RESUME_FROM.has(item.status)) {
          await upsertBoardItem(projectId, {
            id: item.id,
            status: 'in_progress',
            // Chưa ai cầm ⇒ phiên đang chạy nhận lại. Đang có người cầm (team/agent
            // khác) thì giữ nguyên — đổi chủ là quyết định của người dùng trên board.
            ...(item.assigneeSessionId ? {} : { assigneeSessionId: sessionId }),
          })
          await addBoardItemComment(projectId, item.id, {
            from: null,
            fromTitle: 'system',
            text: `${item.status} → in_progress · resumed in "${session.title || sessionId}"`,
          })
        } else if (item.status === 'in_progress' && !item.assigneeSessionId) {
          await upsertBoardItem(projectId, { id: item.id, assigneeSessionId: sessionId })
        }
        return
      }
      await setSessionIssue(sessionId, null)
      emitSessionIssue(sessionId, null)
    }

    if (!isIssueTrackable(session)) return
    const desc = initialDesc(promptText)
    const item = await upsertBoardItem(projectId, {
      title: initialTitle(session, promptText),
      ...(desc ? { desc, autoDesc: true } : {}),
      status: 'in_progress',
      assigneeSessionId: sessionId,
      createdBy: null,
      autoTitle: true,
      originSessionId: sessionId,
    })
    await setSessionIssue(sessionId, item.id)
    emitSessionIssue(sessionId, item.id)
    // Auto-title của renderer có thể đã hạ cánh GIỮA lúc đọc phiên và lúc gắn link —
    // khi đó sessions.upsert chưa thấy issueId nên không đồng bộ. Đọc lại một lần.
    const fresh = await loadSession(sessionId)
    if (fresh?.title && fresh.title !== item.title) await syncIssueTitle(fresh, fresh.title)
  } catch (err) {
    log.warn('session-issue: turn-start sync failed', { sessionId, err: errText(err) })
  }
}

// Auto-title của phiên vừa đổi tên ⇒ issue còn cờ autoTitle thì đổi theo. Người
// đã sửa title issue (cờ mất) thì không đụng.
export async function syncIssueTitle(session: Pick<Session, 'id' | 'projectId' | 'issueId'>, title: string): Promise<void> {
  if (!session.projectId || !session.issueId || !title.trim() || title === PLACEHOLDER_TITLE) return
  try {
    const item = await getBoardItem(session.projectId, session.issueId)
    if (!item?.autoTitle || item.title === title) return
    await upsertBoardItem(session.projectId, { id: item.id, title, autoTitle: true })
  } catch (err) {
    log.warn('session-issue: title sync failed', { sessionId: session.id, err: errText(err) })
  }
}

// Gỡ mọi phiên đang trỏ vào một issue vừa bị xoá — đánh dấu bỏ theo dõi luôn,
// vì xoá issue là người dùng nói "việc này không cần theo dõi", lượt sau mà tự
// sinh lại thì đúng thứ họ vừa gạt đi quay về.
export async function unlinkIssueSessions(projectId: string, issueId: string): Promise<string[]> {
  const unlinked: string[] = []
  try {
    const summaries = await listSessionSummaries()
    for (const s of summaries) {
      if (s.issueId !== issueId || s.projectId !== projectId) continue
      if (await setSessionIssue(s.id, null, true)) {
        emitSessionIssue(s.id, null, true)
        unlinked.push(s.id)
      }
    }
  } catch (err) {
    log.warn('session-issue: unlink after delete failed', { issueId, err: errText(err) })
  }
  return unlinked
}

// Phiên rời issue vì bị XOÁ hoặc vì ĐỔI PROJECT (issueId trỏ vào board project cũ,
// lượt sau tìm trên board mới sẽ không thấy). Issue tự sinh còn trắng thì xoá theo
// (không để rác "Đang làm" của một phiên hỏi vặt đã xoá); còn lại issue SỐNG TIẾP —
// lịch sử việc dài hơn phiên đã làm nó — và được nhả (releaseIssue). Đổi project thì
// gỡ luôn link trên phiên — lượt sau sinh issue mới trên board của project mới.
export async function detachSessionFromIssue(
  session: Pick<Session, 'id' | 'title' | 'projectId' | 'issueId'>,
  reason: 'deleted' | 'moved',
): Promise<void> {
  if (!session.projectId || !session.issueId) return
  const { projectId, issueId } = session
  try {
    if (reason === 'moved') {
      await setSessionIssue(session.id, null)
      emitSessionIssue(session.id, null)
    }
    if (await deleteIfBlank(session.id, projectId, issueId)) return
    const label = session.title || session.id
    await releaseIssue(
      session.id,
      projectId,
      issueId,
      reason === 'deleted' ? `session "${label}" deleted` : `session "${label}" moved to another project`,
    )
  } catch (err) {
    log.warn('session-issue: detach failed', { sessionId: session.id, reason, err: errText(err) })
  }
}

export type SetIssueResult = { issueId: string | null; untracked: boolean; deletedIssueId?: string }

// Đường của người dùng (RPC sessions.setIssue):
//   • `untrack` ⇒ bỏ theo dõi: gỡ link, đặt cờ; issue tự sinh còn trắng thì xoá,
//     còn lại giữ issue nhưng nhả nó (releaseIssue).
//   • `issueId` ⇒ gắn phiên vào một issue CÓ SẴN (tiếp tục việc ở phiên mới); issue
//     cũ (nếu khác) được nhả.
//   • `issueId: null` ⇒ gỡ link (nhả issue cũ); kèm `untrack: false` thì gỡ luôn cờ
//     bỏ theo dõi ("theo dõi lại" — lượt sau tự sinh issue mới), không kèm thì giữ cờ.
export async function setSessionIssueByUser(
  sessionId: string,
  input: { issueId?: string | null; untrack?: boolean },
): Promise<SetIssueResult | null> {
  const session = await loadSession(sessionId)
  if (!session) return null
  const projectId = session.projectId
  const label = session.title || sessionId

  if (input.untrack) {
    let deletedIssueId: string | undefined
    if (projectId && session.issueId) {
      deletedIssueId = await deleteIfBlank(sessionId, projectId, session.issueId)
      if (!deletedIssueId) {
        await releaseIssue(sessionId, projectId, session.issueId, `session "${label}" stopped tracking`)
      }
    }
    await setSessionIssue(sessionId, null, true)
    emitSessionIssue(sessionId, null, true)
    return { issueId: null, untracked: true, ...(deletedIssueId ? { deletedIssueId } : {}) }
  }

  if (input.issueId) {
    if (!projectId) {
      throw new BoardError('invalid-input', 'Session has no project — it cannot be linked to a board issue.')
    }
    const item = await getBoardItem(projectId, input.issueId)
    if (!item) throw new BoardError('unknown-item', `No issue "${input.issueId}" on this project's board.`)
    if (session.issueId && session.issueId !== item.id) {
      await releaseIssue(sessionId, projectId, session.issueId, `session "${label}" moved to another issue`)
    }
    await setSessionIssue(sessionId, item.id, false)
    emitSessionIssue(sessionId, item.id, false)
    await addBoardItemComment(projectId, item.id, {
      from: null,
      fromTitle: 'system',
      text: `linked to session "${label}"`,
    })
    return { issueId: item.id, untracked: false }
  }

  if (projectId && session.issueId) {
    await releaseIssue(sessionId, projectId, session.issueId, `session "${label}" unlinked`)
  }
  const untracked = input.untrack === false ? false : session.issueUntracked === true
  await setSessionIssue(sessionId, null, untracked)
  emitSessionIssue(sessionId, null, untracked)
  return { issueId: null, untracked }
}
