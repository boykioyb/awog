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
import {
  createSession,
  listSessionSummaries,
  updateSessionMetadata,
} from './store.js'
import type {
  Session,
  SessionSettings,
  SessionSummary,
  SpawnChildSpec,
  SpawnSessionConfig,
} from '../types/shared.js'

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
  // Cấu hình NGƯỜI DÙNG đã duyệt trong popover điều phối (chung của lô đã trộn
  // xong với đè riêng của phiên này). Vắng mặt = kế thừa nguyên settings của cha.
  config?: SpawnSessionConfig
}

// Trộn cấu hình đã duyệt lên settings kế thừa của phiên cha. Chỉ field ĐƯỢC ĐẶT
// trong config mới đè — vắng mặt giữ nguyên giá trị cha (đúng nghĩa "kế thừa
// trừ khi người dùng chọn khác trong popover").
export function mergeSpawnConfig(
  base: SessionSettings,
  config: SpawnSessionConfig | undefined,
): SessionSettings {
  if (!config) return base
  const merged: SessionSettings = { ...base }
  if (config.provider !== undefined) merged.provider = config.provider
  if (config.modelId !== undefined) merged.modelId = config.modelId
  if (config.accountId !== undefined) merged.accountId = config.accountId
  if (config.level !== undefined) merged.level = config.level
  if (config.ultracode !== undefined) merged.ultracode = config.ultracode
  if (config.mode !== undefined) merged.mode = config.mode
  if (config.responseStyle !== undefined) merged.responseStyle = config.responseStyle
  if (config.responseStyleNoMarkdown !== undefined) {
    merged.responseStyleNoMarkdown = config.responseStyleNoMarkdown
  }
  return merged
}

// Phiên GỐC của nhóm chứa `sessionId` — chính nó khi nó không thuộc nhóm nào
// hoặc đã là gốc. Trả `undefined` khi id lạ (phiên chưa lưu). Đây cũng là nơi
// `groupSpawnConfig` được tra: popover điều phối chỉ được BỎ QUA khi gốc đã
// nhớ một cấu hình — "duyệt một lần cho cả nhóm" là của NHÓM, không của phiên.
// Bật "workflow tự chạy" cho nhóm của `rootId`: `groupAutoDeliver` lên gốc.
// `updateSessionMetadata` không phát event nào — nếu chỉ ghi đĩa thì renderer
// không biết cờ đã đứng, và tin giao việc đến ngay sau đó rơi vào chip chờ
// "Giao cho agent" (đúng thứ cờ này sinh ra để bỏ). `session.group-armed` là
// kênh duy nhất đẩy cờ xuống UI, nó còn vá luôn khe hở cửa sổ-popout.
export async function armGroupAutoDeliver(rootId: string): Promise<void> {
  await updateSessionMetadata(rootId, { groupAutoDeliver: true })
  emit('session.group-armed', { sessionId: rootId })
}

export function groupRootOf(
  summaries: SessionSummary[],
  sessionId: string,
): SessionSummary | undefined {
  const caller = summaries.find((s) => s.id === sessionId)
  if (!caller) return undefined
  if (!caller.groupParentId) return caller
  return summaries.find((s) => s.id === caller.groupParentId) ?? caller
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
  // Kế thừa provider/model/account của phiên cha, ĐÈ bởi cấu hình người dùng đã
  // duyệt trong popover điều phối (input.config). Model không tự chọn được nhà
  // cung cấp — `config` chỉ tới từ quyết định của NGƯỜI DÙNG (spawn-approval) hoặc
  // RPC spawnChildren của UI, không bao giờ từ tham số tool.
  const settings = mergeSpawnConfig(parent.settings, input.config)
  const session: Session = {
    id,
    title,
    projectId: parent.projectId,
    createdAt: now,
    updatedAt: now,
    invitedAgentIds: [],
    messages: [],
    pendingAgentIds: [],
    settings,
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
    settings,
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

export interface SpawnChildrenResult {
  created: { id: string; title: string }[]
  // Từng phiên con là một hệ quả độc lập: một phiên hỏng (tiêu đề rỗng, chạm
  // trần giữa chừng) không được làm mất phần đã tạo — danh sách lỗi đi kèm để
  // model/UI nói được chuyện gì đã xảy ra.
  failed: { title: string; reason: string }[]
}

// Tạo MỘT LÔ phiên con dưới cùng một cha (popover điều phối duyệt nhiều phiên
// một lần, hoặc RPC `sessions.spawnChildren` của UI). Trần nhóm (MAX_CHILDREN)
// vẫn cầm chừng qua `spawnChildSession` ở mỗi vòng — nhưng đếm TRƯỚC cả lô để
// trả một lỗi sạch sẽ thay vì nửa đẻ nửa từ chối.
export async function spawnChildrenSessions(
  parentId: string,
  children: SpawnChildSpec[],
): Promise<SpawnChildrenResult> {
  const summaries = await listSessionSummaries()
  const caller = summaries.find((s) => s.id === parentId)
  if (!caller) {
    throw new SpawnError(
      'unknown-parent',
      'This session is not saved yet, so it cannot own a sub-session.',
    )
  }
  const rootId = caller.groupParentId ?? parentId
  const existing = summaries.filter((s) => s.groupParentId === rootId).length
  if (existing + children.length > MAX_CHILDREN) {
    throw new SpawnError(
      'too-many-children',
      `This group already has ${existing} sub-sessions and the request asks for ${children.length} more, over the limit of ${MAX_CHILDREN}. Drop some and try again.`,
    )
  }
  const created: { id: string; title: string }[] = []
  const failed: { title: string; reason: string }[] = []
  for (const child of children) {
    try {
      created.push(
        await spawnChildSession({
          parentId,
          title: child.title,
          role: child.role,
          prompt: child.prompt,
          ...(child.config ? { config: child.config } : {}),
        }),
      )
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      log.warn('spawnChildren: a child failed', { title: child.title, reason })
      failed.push({ title: child.title || '(untitled)', reason })
    }
  }
  return { created, failed }
}
