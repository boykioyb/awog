// Materialize LƯỜI member của một team run (session-teams §9).
//
// `teams.run` chỉ tạo phiên LEAD — member của spec không có phiên cho tới khi
// được giao VIỆC THẬT. Khi một board item nhận `assignee_member` (title hoặc
// agent id của member trong spec), runner của board gọi `materializeMember`:
// spec → session con dưới gốc run, bind agent của member, prompt đầu chính là
// lời giao việc. Member đã có phiên sống ⇒ dùng lại, KHÔNG đẻ thêm.
//
// Tách file riêng thay vì nằm trong board-tools vì block `<team>` của lead
// (team-context.ts) cũng cần resolve spec + tính "bench" (member chưa spawn).

import { loadTeam, MAX_TEAM_MEMBERS } from '../teams/store.js'
import { listBoardItems } from '../boards/store.js'
import { log } from '../util/logger.js'
import { setSessionLlmOverride } from './store.js'
import { spawnChildSession, SpawnError } from './spawn.js'
import type {
  SessionLlmOverride,
  SessionSummary,
  SpawnSessionConfig,
  TeamSpec,
} from '../types/shared.js'

// SessionLlmOverride → SpawnSessionConfig: bỏ field `undefined` hẳn thay vì
// truyền key-rỗng (exactOptionalPropertyTypes + mergeSpawnConfig chỉ đè field
// ĐƯỢC ĐẶT — giữ đúng ngữ nghĩa "vắng mặt = không đè").
function llmOverrideToConfig(ov: SessionLlmOverride): SpawnSessionConfig {
  const cfg: SpawnSessionConfig = {}
  if (ov.provider !== undefined) cfg.provider = ov.provider
  if (ov.modelId !== undefined) cfg.modelId = ov.modelId
  if (ov.accountId !== undefined) cfg.accountId = ov.accountId
  if (ov.level !== undefined) cfg.level = ov.level
  if (ov.mode !== undefined) cfg.mode = ov.mode
  return cfg
}

export type SpecMember = TeamSpec['members'][number]

// Nạp spec mà run này materialize từ. `teamSource`/`teamProjectId` ghi trên
// phiên gốc từ teams.run — header cũ thiếu chúng thì dò global trước rồi
// project ĐÍCH của run (cùng quy ước loadAgentFlexibly).
export async function loadRunTeam(root: SessionSummary): Promise<TeamSpec | null> {
  if (!root.teamId) return null
  try {
    if (root.teamSource) {
      return await loadTeam(
        root.teamId,
        root.teamSource,
        root.teamSource === 'project' ? root.teamProjectId : undefined,
      )
    }
    return (
      (await loadTeam(root.teamId, 'global')) ??
      (root.projectId ? await loadTeam(root.teamId, 'project', root.projectId) : null)
    )
  } catch (err) {
    log.warn('team-members: spec load failed', {
      teamId: root.teamId,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// Khớp một spec member theo KHOÁ người/agent gửi: title (không phân biệt hoa
// thường) hoặc agent id. Trả undefined khi không khớp — caller liệt kê roster
// trong lỗi để model tự sửa.
export function findSpecMember(team: TeamSpec, key: string): SpecMember | undefined {
  const k = key.trim().toLowerCase()
  return team.members.find(
    (m) => m.title.trim().toLowerCase() === k || m.agent?.id === key.trim(),
  )
}

// Phiên SỐNG của run đã là run của member này chưa — agent.id khớp (khi spec
// bind agent) là nhận diện mạnh nhất; title khớp làm fallback cho member
// không bind và con đẻ tay cùng tên. Con đã lưu trữ KHÔNG tính còn sống.
export function liveMemberSession(
  summaries: SessionSummary[],
  runId: string,
  member: SpecMember,
): SessionSummary | undefined {
  return summaries.find(
    (s) =>
      s.teamRunId === runId &&
      !s.archived &&
      ((member.agent?.id && s.agent?.id === member.agent.id) || s.title === member.title),
  )
}

// "Bench" — member spec chưa có phiên sống trong run. Block <team> của lead
// liệt kê chúng để lead biết còn ai để giao mà không cần spawn sẵn.
export function benchMembers(
  team: TeamSpec,
  summaries: SessionSummary[],
  runId: string,
): SpecMember[] {
  return team.members.filter((m) => !liveMemberSession(summaries, runId, m))
}

export interface MaterializedMember {
  sessionId: string
  // true = vừa đẻ phiên mới (prompt đầu đã là lời giao việc — caller KHÔNG
  // wake thêm); false = member đã sống, caller wake bình thường.
  spawned: boolean
  title: string
}

// Tra override LLM của người dùng cho MỘT member trên một board item
// (assigneeConfig['member:<title>'] — editor → Advanced). `itemId` vắng →
// undefined: không có item thì không có override. Đọc lại item ở ĐÂY thay vì
// tin vào payload caller vì override có thể được sửa giữa lúc đặt và lúc
// materialize (đổi account khi hết token trước khi member spawn).
// Best-effort: board hỏng/không đọc được ⇒ undefined, member spawn theo
// settings thường thay vì chặn cả dispatch.
export async function loadMemberLlmOverride(
  projectId: string,
  itemId: string | undefined,
  memberTitle: string,
): Promise<SessionLlmOverride | undefined> {
  if (!itemId) return undefined
  try {
    const items = await listBoardItems(projectId)
    const item = items.find((i) => i.id === itemId)
    return item?.assigneeConfig?.[`member:${memberTitle}`]
  } catch (err) {
    log.warn('team-members: assigneeConfig lookup failed', {
      projectId,
      itemId,
      err: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}

// Tìm-hoặc-spawn phiên của một spec member trong run. `dispatchPrompt` = tin
// đầu tiên vào inbox member khi spawn — caller viết nó THÀNH lời giao việc
// (đã biết item nên prompt mang title/id thật), vì vậy member vừa đẻ không
// cần thêm tin wake nào nữa.
export async function materializeMember(input: {
  runId: string
  team: TeamSpec
  member: SpecMember
  summaries: SessionSummary[]
  dispatchPrompt: string
  // Override LLM của người dùng trên board item (member:<title>) — merge vào
  // settings phiên con VÀ ghi lên session.llmOverride để pin của agent bind
  // không đè lại nó ở lượt chạy. Member đã sống ⇒ vẫn ghi override (nó là quyết
  // định mới nhất của người dùng).
  llmOverride?: SessionLlmOverride | undefined
}): Promise<MaterializedMember> {
  const live = liveMemberSession(input.summaries, input.runId, input.member)
  if (live) {
    if (input.llmOverride) {
      await setSessionLlmOverride(live.id, input.llmOverride).catch((err) => {
        log.warn('team-members: live-member llmOverride write failed', {
          sessionId: live.id,
          err: err instanceof Error ? err.message : String(err),
        })
      })
    }
    return { sessionId: live.id, spawned: false, title: live.title || input.member.title }
  }

  // Member của spec là danh sách NGƯỜI DÙNG đã duyệt — spawn thẳng qua
  // spawnChildSession (không qua popover create_session: popover là cổng cho
  // fanout do MODEL bịa, còn đây là materialize một spec có sẵn). Trần con
  // của run nới theo spec (MAX_TEAM_MEMBERS) y hệt teams.run từng làm.
  try {
    const res = await spawnChildSession({
      parentId: input.runId,
      title: input.member.title,
      role: '',
      prompt: input.dispatchPrompt,
      ...(input.member.agent?.id ? { agentId: input.member.agent.id } : {}),
      ...(input.member.agent?.source ? { agentSource: input.member.agent.source } : {}),
      ...(input.member.agent?.projectId
        ? { agentProjectId: input.member.agent.projectId }
        : {}),
      // Override cũng đi vào config để settings phiên (summary/hiển thị) phản
      // ánh đúng lựa chọn — không chỉ tầng llmOverride ở lượt chạy.
      ...(input.llmOverride ? { config: llmOverrideToConfig(input.llmOverride) } : {}),
      maxRunChildren: MAX_TEAM_MEMBERS,
    })
    if (input.llmOverride) {
      await setSessionLlmOverride(res.id, input.llmOverride).catch((err) => {
        log.warn('team-members: spawned-member llmOverride write failed', {
          sessionId: res.id,
          err: err instanceof Error ? err.message : String(err),
        })
      })
    }
    return { sessionId: res.id, spawned: true, title: res.title }
  } catch (err) {
    if (err instanceof SpawnError) throw err
    log.warn('team-members: member spawn failed', {
      member: input.member.title,
      err: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
