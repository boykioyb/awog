// Sinh một phiên CON trong cây nhóm — nền của tool `create_session` (hướng A: phiên
// điều phối phiên).
//
// ─── Vì sao sidecar KHÔNG tự chạy lượt đầu của phiên con ──────────────────────
// Sidecar không có primitive "bắt đầu một lượt" — phiên do RENDERER lái (xem
// sessions/runner.ts + mô hình wake của ADR 0066 P2). Nên hàm này chỉ làm hai việc:
// tạo phiên trên đĩa, rồi đặt lời giao việc vào HỘP THƯ của nó qua đúng
// `postSessionMessage` mà mọi tin liên phiên đi qua. Từ đó renderer quyết định: nhóm
// đã bật tự giao ⇒ chạy ngay; chưa bật ⇒ hiện chip cho người dùng bấm.
//
// Nhờ vậy không có đường thứ hai nào đi vào một phiên: cùng hàng rào nonce, cùng
// `redactString`, cùng ba trần chống lạm dụng.
//
// ─── Trần ────────────────────────────────────────────────────────────────────
// Một phiên điều phối lạc lối có thể đẻ phiên con vô hạn, và MỖI phiên con là một
// lượt LLM tốn tiền thật. Hai trần độc lập: số con TRỰC TIẾP của một phiên
// (MAX_CHILDREN, ở đây) và số phiên một LƯỢT được đẻ (đếm trong closure của toolset,
// giống MAX_MESSAGES_PER_TURN).

import { randomBytes } from 'node:crypto'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { InboxError, oneLineLabel, postSessionMessage } from './inbox.js'
import { createSession, listSessionSummaries } from './store.js'
import type { Session, SessionSummary } from '../types/shared.js'

// Trần số con TRỰC TIẾP của một phiên. Nhóm lớn hơn chừng này thì vấn đề không còn là
// điều phối nữa — và người dùng vẫn tự tay xếp thêm được qua UI.
export const MAX_CHILDREN = 12
// Trần số phiên một LƯỢT được đẻ. Giao việc cho cả một ê-kíp trong một lượt là hợp
// lệ; đẻ ra hai chục phiên thì không.
export const MAX_SPAWNS_PER_TURN = 4
// Tiêu đề hiện trên hàng danh sách — một dòng, cắt ngắn.
export const MAX_TITLE_LEN = 80
// Vai trong nhóm. Khớp trần của `sessions.setGroup` — cùng một field trên header.
export const MAX_ROLE_LEN = 60

export type SpawnErrorCode = 'unknown-parent' | 'too-many-children' | 'invalid-input'

export class SpawnError extends Error {
  constructor(
    readonly code: SpawnErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SpawnError'
  }
}

// Id của phiên do SIDECAR sinh ra.
//
// KHÔNG dùng được `utils/session-slug.ts` của renderer: slug đó suy ra một cách TẤT
// ĐỊNH từ `clientId` (số thứ tự trong store của renderer), thứ sidecar không có và
// không nên biết. Nên ở đây là ngày + ngẫu nhiên từ CSPRNG. Vẫn khớp `SESSION_ID_RE`
// (`^[a-z0-9-]+$`) của các RPC nhận id, và vẫn sắp được theo thời gian nhờ tiền tố ngày.
function mintSessionId(): string {
  const d = new Date()
  const yy = String(d.getFullYear()).slice(2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yy}${mm}${dd}-agent-${randomBytes(4).toString('hex')}`
}

export interface SpawnChildInput {
  // Phiên GỌI — sẽ thành cha của phiên mới.
  parentId: string
  title: string
  role: string
  // Lời giao việc, đặt vào hộp thư phiên con.
  prompt: string
}

export interface SpawnChildResult {
  id: string
  title: string
}

// Tạo một phiên con dưới `parentId` rồi giao việc đầu tiên cho nó.
export async function spawnChildSession(input: SpawnChildInput): Promise<SpawnChildResult> {
  // Tiêu đề và vai do MODEL viết ⇒ L1 với mọi bề mặt đọc chúng sau này (hàng danh
  // sách, danh bạ liên phiên). Đi qua đúng cách xử lý của tiêu đề phiên trong danh bạ.
  const title = oneLineLabel(input.title, MAX_TITLE_LEN)
  const role = oneLineLabel(input.role, MAX_ROLE_LEN)
  if (!title) throw new SpawnError('invalid-input', 'The new session needs a title.')

  const summaries = await listSessionSummaries()
  const caller = summaries.find((s) => s.id === input.parentId)
  if (!caller) {
    throw new SpawnError(
      'unknown-parent',
      'This session is not saved yet, so it cannot own a sub-session. Answer the user here instead.',
    )
  }
  // Nhóm chỉ có HAI CẤP. Phiên gọi đã là con ⇒ phiên mới thành ANH EM của nó (con của
  // cùng một gốc), không phải cháu. Nếu không, một phiên điều phối giao việc cho BA rồi
  // BA tự đẻ tiếp sẽ dựng ra một cái cây sâu mà bảng trạng thái và lưới đều chỉ hiện
  // được một tầng.
  const parentId = caller.groupParentId ?? input.parentId
  const parent = summaries.find((s) => s.id === parentId) ?? caller
  const children = summaries.filter((s) => s.groupParentId === parentId).length
  if (children >= MAX_CHILDREN) {
    throw new SpawnError(
      'too-many-children',
      `This session already has ${children} sub-sessions, which is the limit. Reuse one of them instead of creating another.`,
    )
  }

  const id = mintSessionId()
  const now = new Date().toISOString()
  // Kế thừa provider/model/account của phiên cha. CỐ Ý không cho model chọn: chọn nhà
  // cung cấp là tiêu tiền trên một tài khoản cụ thể, và đó là quyết định của người
  // dùng. Họ đổi được sau, ngay trên phiên con, bằng bộ chọn thường ngày.
  const session: Session = {
    id,
    title,
    projectId: parent.projectId,
    createdAt: now,
    updatedAt: now,
    invitedAgentIds: [],
    messages: [],
    pendingAgentIds: [],
    settings: parent.settings,
    groupParentId: parentId,
    ...(role ? { groupRole: role } : {}),
  }
  await createSession(session)

  // Renderer phải BIẾT phiên này trước khi lời giao việc tới, nếu không nó không tìm
  // ra đích để tự giao. Hai event đi cùng một kênh stdio theo thứ tự, nên phát
  // `session.created` TRƯỚC là đủ — không cần bắt tay gì thêm.
  const summary: SessionSummary = {
    id,
    title,
    projectId: parent.projectId,
    createdAt: now,
    updatedAt: now,
    status: 'idle',
    invitedAgentIds: [],
    pendingAgentIds: [],
    settings: parent.settings,
    messageCount: 0,
    groupParentId: parentId,
    ...(role ? { groupRole: role } : {}),
  }
  emit('session.created', { session: summary })

  // Giao việc đi đúng đường của mọi tin liên phiên: khử bí mật + hàng rào nonce + ba
  // trần. Đây là cạnh cha→con nên nó được miễn trần hop (xem isGroupHandoff).
  try {
    await postSessionMessage({ from: input.parentId, to: id, text: input.prompt })
  } catch (err) {
    // Phiên đã tạo xong: KHÔNG xoá nó đi. Người dùng vẫn mở được và tự giao việc bằng
    // tay — im lặng xoá một phiên vừa hiện ra trong danh sách còn khó hiểu hơn nhiều
    // so với một phiên rỗng có thật.
    const reason = err instanceof InboxError ? err.message : String(err)
    log.warn('spawn: child created but its first assignment was refused', { id, reason })
    throw new SpawnError(
      'invalid-input',
      `Session "${title}" was created (id ${id}) but its first assignment was refused: ${reason}`,
    )
  }

  return { id, title }
}
