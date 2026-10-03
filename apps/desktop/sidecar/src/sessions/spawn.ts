// Sinh một phiên CON trong cây nhóm — nền của tool `create_session` (hướng A: phiên
// điều phối phiên).
//
// ─── Vì sao sidecar KHÔNG tự chạy lượt đầu của phiên con ──────────────────────
// Sidecar không có primitive "bắt đầu một lượt" — phiên do RENDERER lái (xem
// sessions/runner.ts + mô hình wake của ADR 0066 P2). Nên hàm này chỉ làm hai việc:
// tạo phiên trên đĩa, rồi đặt lời giao việc vào HỘP THƯ của nó qua đúng
// `postSessionMessage` mà mọi tin liên phiên đi qua. Từ đó renderer TỰ GIAO:
// phiên con rảnh ⇒ chạy ngay; đang bận ⇒ xếp sau lượt hiện tại.
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
import { loadAgent } from '../agents/store.js'
import { InboxError, MAX_TEXT_LEN, oneLineLabel, postSessionMessage } from './inbox.js'
import { createSession, listSessionSummaries } from './store.js'
import type {
  Session,
  SessionAgentRef,
  SessionSettings,
  SessionSummary,
  SpawnSessionConfig,
} from '../types/shared.js'
import type { SpawnChildSpec as SpawnChildSpecBase } from '../types/shared.js'

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
export function mintSessionId(): string {
  const d = new Date()
  const yy = String(d.getFullYear()).slice(2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yy}${mm}${dd}-agent-${randomBytes(4).toString('hex')}`
}

// Bộ đặc tả phiên con đi qua MỌI đường spawn (tool `create_session`, popover
// `sessions.spawnMembers`/`sessions.spawnResolve`) — `SpawnChildSpec` của
// types/shared.ts cộng thêm tuple bind agent. Tuple ở đây chứ không trên
// shared.ts vì file đó đang được một track khác của feature này chỉnh sửa;
// `Session.agent` gói ba field này lại thành `SessionAgentRef`.
//
// Cả ba đều OPTIONAL để spec cũ (tool/RPC trước feature, popover không chọn
// agent) vẫn hợp lệ nguyên vẹn — vắng mặt = không bind, phiên con chạy prompt
// thường y hệt trước.
export interface SpawnChildSpec extends SpawnChildSpecBase {
  // Id agent AWOG (AGENT.md) bind vào phiên con — "vai có thật"
  // (docs/features/session-teams.md §3): systemPrompt/model/tools của agent áp
  // lên mọi lượt của nó. Ghi nguyên vào `session.agent`.
  agentId?: string
  // Tier của agent: 'global' (~/.claude/agents) hoặc 'project'
  // (<project>/.claude/agents) — một id có thể tồn tại ở cả hai tier.
  agentSource?: 'global' | 'project'
  // Project sở hữu agent khi `agentSource === 'project'` (member kế thừa
  // projectId của cha — UI nên gửi đủ tuple từ picker).
  agentProjectId?: string
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
  // Tuple agent bind vào phiên con — đi nguyên vào `session.agent`.
  agentId?: string
  agentSource?: 'global' | 'project'
  agentProjectId?: string
  // Trần con của cả run — spawnMemberSessions/materializeMember truyền xuống
  // để đường spec (teams.run, assignee_member) nới cap theo danh sách người
  // dùng đã duyệt. Vắng mặt = MAX_CHILDREN.
  maxRunChildren?: number
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

// Phiên GỐC của nhóm chứa `sessionId` — chính nó khi không thuộc nhóm nào
// hoặc đã là gốc. Trả `undefined` khi id lạ (phiên chưa lưu). Đây cũng là nơi
// `spawnConfig` được tra: popover điều phối chỉ được BỎ QUA khi gốc đã
// nhớ một cấu hình — "duyệt một lần cho cả nhóm" là của NHÓM, không của phiên.
export function runRootOf(
  summaries: SessionSummary[],
  sessionId: string,
): SessionSummary | undefined {
  const caller = summaries.find((s) => s.id === sessionId)
  if (!caller) return undefined
  if (!caller.teamRunId) return caller
  return summaries.find((s) => s.id === caller.teamRunId) ?? caller
}

export interface SpawnChildResult {
  id: string
  title: string
}

// Lời giao việc đầu tiên phải LUÔN qua được hộp thư: phiên con đã được tạo (và
// đã hiện trong danh sách của người dùng) TRƯỚC khi tin này đi, nên một refusal
// từ `postSessionMessage` để lại một phiên "mồ côi" — trông như chưa chạy, mà
// không có chip nào để giao tay nữa, và cha thì nhận lỗi rồi có thể gọi
// `create_session` lại (popover hỏi lại). Hai chuẩn hoá duy nhất tin này cần:
//   • rỗng → lời giao tối thiểu nhắc nó là ai + hỏi lại cha;
//   • dài quá trần hộp thư → cắt có dấu hiệu (không âm thầm mất phần đuôi —
//     dòng marker cho con biết nó đang đọc bản thiếu).
// Mọi refusal còn lại (đích lạ / đã lưu trữ / tự gửi cho mình) vẫn ném —
// chúng là lỗi lập trình thật, không phải độ dài.
function spawnPromptText(prompt: string, title: string, role: string): string {
  const trimmed = prompt.trim()
  if (!trimmed) {
    return (
      `You are "${title}"${role ? ` (role: ${role})` : ''}, a sub-session created under an approved orchestrated workflow. ` +
      'Your assignment arrived empty — send_session_message back to the parent session to ask what it needs from you.'
    )
  }
  if (trimmed.length <= MAX_TEXT_LEN) return trimmed
  const marker = `\n\n[truncated — the assignment exceeded the ${MAX_TEXT_LEN}-character message limit; ask the parent session for the missing part if needed]`
  return trimmed.slice(0, MAX_TEXT_LEN - marker.length) + marker
}

// Tra tên hiển thị của một agent để làm nhãn `teamRole` khi spec bind agent mà
// không gửi `role` — "vai có thật" đã có sẵn một cái tên đúng ngữ nghĩa. Đây là
// suy diễn NHÃN thuần tuý: agent lạ/đã xoá thì vai để trống, binding vẫn được
// ghi vì `id` là đủ cho `resolveAgentContext` ở lượt chạy.
//
// `projectId` ở đây là NGỮ CẢNH tra cứu (member kế thừa project của cha — dùng
// `parent.projectId` khi spec không nói rõ), KHÔNG phải giá trị ghi vào
// `agent` — ref lưu nguyên những gì caller gửi.
async function agentRoleLabel(
  agentId: string,
  source: 'global' | 'project' | undefined,
  projectId: string | null | undefined,
): Promise<string> {
  try {
    let agent = null
    if (source) {
      agent = await loadAgent(agentId, source, projectId ?? undefined)
    } else {
      // Chưa biết tier: thử global trước (phổ biến hơn), rồi project của phiên —
      // đúng thứ tự ưu tiên mà `loadAgentFlexibly` (tasks/agent-context.ts) áp.
      agent = await loadAgent(agentId, 'global')
      if (!agent && projectId) agent = await loadAgent(agentId, 'project', projectId)
    }
    return agent?.name ?? ''
  } catch (err) {
    log.warn('spawn: agent lookup for role label failed', {
      agentId,
      err: err instanceof Error ? err.message : String(err),
    })
    return ''
  }
}

// Tạo một phiên con dưới `parentId` rồi giao việc đầu tiên cho nó.
export async function spawnChildSession(input: SpawnChildInput): Promise<SpawnChildResult> {
  // Tiêu đề và vai do MODEL viết ⇒ L1 với mọi bề mặt đọc chúng sau này (hàng danh
  // sách, danh bạ liên phiên). Đi qua đúng cách xử lý của tiêu đề phiên trong danh bạ.
  const title = oneLineLabel(input.title, MAX_TITLE_LEN)
  let role = oneLineLabel(input.role, MAX_ROLE_LEN)
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
  const parentId = caller.teamRunId ?? input.parentId
  const parent = summaries.find((s) => s.id === parentId) ?? caller
  const children = summaries.filter((s) => s.teamRunId === parentId).length
  const maxRunChildren = input.maxRunChildren ?? MAX_CHILDREN
  if (children >= maxRunChildren) {
    throw new SpawnError(
      'too-many-children',
      `This session already has ${children} sub-sessions, which is the limit. Reuse one of them instead of creating another.`,
    )
  }

  // Vai trống mà có bind agent ⇒ mượn tên agent làm nhãn (roster hiện "vai có
  // thật"). Tra cứu dùng project của CHA làm ngữ cảnh khi spec không nói rõ tier.
  if (!role && input.agentId) {
    role = oneLineLabel(
      await agentRoleLabel(
        input.agentId,
        input.agentSource,
        input.agentProjectId ?? parent.projectId,
      ),
      MAX_ROLE_LEN,
    )
  }
  // Ref agent ghi NGUYÊN tuple caller gửi (không điền projectId của cha): ref
  // chỉ là con trỏ — tier được `resolveAgentContext` resolve lại mỗi lượt.
  const agent: SessionAgentRef | undefined = input.agentId
    ? {
        id: input.agentId,
        ...(input.agentSource ? { source: input.agentSource } : {}),
        ...(input.agentProjectId ? { projectId: input.agentProjectId } : {}),
      }
    : undefined

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
    teamRunId: parentId,
    ...(role ? { teamRole: role } : {}),
    ...(agent ? { agent } : {}),
    // Member thừa hưởng link team spec của lead — run ad-hoc (không qua spec)
    // thì vắng mặt. teamSource/teamProjectId đi cùng để materialize member
    // lười (board-tools) resolve đúng file spec kể cả khi member được đẻ ra
    // TRƯỚC khi chính nó gọi assignee_member (member dispatch cho bạn bè).
    ...(parent.teamId ? { teamId: parent.teamId } : {}),
    ...(parent.teamSource ? { teamSource: parent.teamSource } : {}),
    ...(parent.teamProjectId ? { teamProjectId: parent.teamProjectId } : {}),
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
    teamRunId: parentId,
    ...(role ? { teamRole: role } : {}),
    ...(agent ? { agent } : {}),
    ...(parent.teamId ? { teamId: parent.teamId } : {}),
    ...(parent.teamSource ? { teamSource: parent.teamSource } : {}),
    ...(parent.teamProjectId ? { teamProjectId: parent.teamProjectId } : {}),
  }
  emit('session.created', { session: summary })

  // Giao việc đi đúng đường của mọi tin liên phiên: khử bí mật + hàng rào nonce + ba
  // trần. Đây là cạnh cha→con nên nó được miễn trần hop (xem isRunHandoff). Tin
  // đi qua spawnPromptText trước — một refusal ở đây mồ côi hoá phiên vừa tạo.
  try {
    await postSessionMessage({
      from: input.parentId,
      to: id,
      text: spawnPromptText(input.prompt, title, role),
    })
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
// một lần, RPC `sessions.spawnMembers` của UI, hoặc materialize LƯỜI member
// của team spec — `assignee_member` trên board tools → `materializeMember`).
// Trần nhóm mặc định MAX_CHILDREN; đường spec truyền cap riêng
// (MAX_TEAM_MEMBERS) vì spec là danh sách người dùng tự duyệt, không phải fanout
// do model bịa — và phải khớp trần teams.upsert để spec hợp lệ chạy được.
// Trần vẫn cầm chừng qua `spawnChildSession` ở mỗi vòng — nhưng đếm TRƯỚC cả
// lô để trả một lỗi sạch sẽ thay vì nửa đẻ nửa từ chối.
export async function spawnMemberSessions(
  parentId: string,
  children: SpawnChildSpec[],
  maxPerRun: number = MAX_CHILDREN,
): Promise<SpawnChildrenResult> {
  const summaries = await listSessionSummaries()
  const caller = summaries.find((s) => s.id === parentId)
  if (!caller) {
    throw new SpawnError(
      'unknown-parent',
      'This session is not saved yet, so it cannot own a sub-session.',
    )
  }
  const rootId = caller.teamRunId ?? parentId
  const existing = summaries.filter((s) => s.teamRunId === rootId).length
  if (existing + children.length > maxPerRun) {
    throw new SpawnError(
      'too-many-children',
      `This run already has ${existing} sub-sessions and the request asks for ${children.length} more, over the limit of ${maxPerRun}. Drop some and try again.`,
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
          ...(child.agentId ? { agentId: child.agentId } : {}),
          ...(child.agentSource ? { agentSource: child.agentSource } : {}),
          ...(child.agentProjectId ? { agentProjectId: child.agentProjectId } : {}),
          ...(maxPerRun !== MAX_CHILDREN ? { maxRunChildren: maxPerRun } : {}),
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
