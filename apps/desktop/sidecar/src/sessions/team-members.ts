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
import { applyRoute, effectiveProvider, routeForItem } from '../boards/model-route.js'
import { log } from '../util/logger.js'
import { setSessionLlmOverride } from './store.js'
import { emit } from '../transport/stdio.js'
import { spawnChildSession, SpawnError } from './spawn.js'
import type {
  BoardItem,
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

// Một spec member là một VAI TRÒ, không phải một ghế duy nhất: lead có thể xếp
// nhiều ghế song song của cùng role (`member_instance` trên board tools — Dev
// làm frontend còn "Dev 2" làm backend). Ghế N≥2 là một phiên riêng mang title
// `<member title> N`, thừa hưởng agent binding + assigneeConfig của role.
// Cap chặn typo kiểu "Dev 99" và fanout mất kiểm soát — trần run con
// (MAX_TEAM_MEMBERS) vẫn áp như thường.
export const MAX_MEMBER_INSTANCES = 4

// Title của ghế: ghế gốc = title spec; ghế N = "<title> N".
export function memberSeatTitle(member: SpecMember, instance?: number): string {
  return instance !== undefined && instance >= 2 ? `${member.title} ${instance}` : member.title
}

// "<member title> <số>" — nhận diện một phiên là GHẾ instance của member này,
// để lookup ghế gốc không bốc nhầm "Dev 2" khi đi tìm "Dev".
const seatTitleRe = (title: string): RegExp =>
  new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d+$`)

// Phiên SỐNG của run đang giữ ghế của member này. Ghế gốc (instance vắng/1):
// agent.id khớp (khi spec bind agent) là nhận diện mạnh nhất — nhưng phải loại
// các ghế instance ("Dev 2" mang cùng agent binding mà không phải ghế gốc);
// title khớp làm fallback cho member không bind và con đẻ tay cùng tên. Ghế
// N≥2 chỉ khớp theo title — agent.id của mọi ghế là giống nhau. Con đã lưu
// trữ KHÔNG tính còn sống.
export function liveMemberSession(
  summaries: SessionSummary[],
  runId: string,
  member: SpecMember,
  instance?: number,
): SessionSummary | undefined {
  if (instance !== undefined && instance >= 2) {
    const seat = memberSeatTitle(member, instance)
    return summaries.find(
      (s) => s.teamRunId === runId && !s.archived && s.title === seat,
    )
  }
  const instRe = seatTitleRe(member.title)
  return summaries.find(
    (s) =>
      s.teamRunId === runId &&
      !s.archived &&
      (s.title === member.title ||
        (!!member.agent?.id && s.agent?.id === member.agent.id && !instRe.test(s.title ?? ''))),
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
  // Title GHẾ khi dispatch vào một instance ("Dev 2") — key `member:<seat>`
  // thắng nếu user tinh chỉnh riêng cho ghế đó, còn không thì kế thừa config
  // của cả role (`member:<title>`).
  seatTitle?: string,
): Promise<SessionLlmOverride | undefined> {
  if (!itemId) return undefined
  try {
    const items = await listBoardItems(projectId)
    const cfg = items.find((i) => i.id === itemId)?.assigneeConfig
    if (!cfg) return undefined
    if (seatTitle && cfg[`member:${seatTitle}`]) return cfg[`member:${seatTitle}`]
    return cfg[`member:${memberTitle}`]
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
  // Item đang được giao → auto-route modelId/level theo tính chất việc
  // (model-route). Route ĐÈ modelId/level của llmOverride tay — dispatch là lúc
  // quyết lại cấu hình; provider/accountId/mode của user được giữ nguyên.
  routeItem?: Pick<BoardItem, 'type' | 'priority' | 'severity' | 'desc'> | undefined
  // Ghế instance (≥2): spawn/tái dùng phiên "<member title> N" — một ghế
  // song song của cùng role. Vắng/1 = ghế gốc.
  instance?: number | undefined
}): Promise<MaterializedMember> {
  // Override HIỆU DỤNG = manual (nếu có) sau khi auto-route đè modelId/level.
  // Provider để route: override tay → pin của agent member → settings của gốc
  // run (con kế thừa provider cha qua mergeSpawnConfig).
  let override = input.llmOverride
  if (input.routeItem) {
    const provider = await effectiveProvider({
      override,
      agent: input.member.agent,
      fallback: input.summaries.find((s) => s.id === input.runId)?.settings.provider,
    })
    if (provider) {
      override = applyRoute(override, routeForItem(input.routeItem, provider))
    }
  }

  const seatTitle = memberSeatTitle(input.member, input.instance)
  const live = liveMemberSession(input.summaries, input.runId, input.member, input.instance)
  if (live) {
    if (override) {
      await setSessionLlmOverride(live.id, override)
        .then((ok) => {
          if (ok) emit('session.llm-override', { sessionId: live.id, llmOverride: override })
        })
        .catch((err) => {
          log.warn('team-members: live-member llmOverride write failed', {
            sessionId: live.id,
            err: err instanceof Error ? err.message : String(err),
          })
        })
    }
    return { sessionId: live.id, spawned: false, title: live.title || seatTitle }
  }

  // Member của spec là danh sách NGƯỜI DÙNG đã duyệt — spawn thẳng qua
  // spawnChildSession (không qua popover create_session: popover là cổng cho
  // fanout do MODEL bịa, còn đây là materialize một spec có sẵn). Trần con
  // của run nới theo spec (MAX_TEAM_MEMBERS) y hệt teams.run từng làm.
  try {
    const res = await spawnChildSession({
      parentId: input.runId,
      title: seatTitle,
      role: '',
      prompt: input.dispatchPrompt,
      ...(input.member.agent?.id ? { agentId: input.member.agent.id } : {}),
      ...(input.member.agent?.source ? { agentSource: input.member.agent.source } : {}),
      ...(input.member.agent?.projectId
        ? { agentProjectId: input.member.agent.projectId }
        : {}),
      // Override cũng đi vào config để settings phiên (summary/hiển thị) phản
      // ánh đúng lựa chọn — không chỉ tầng llmOverride ở lượt chạy.
      ...(override ? { config: llmOverrideToConfig(override) } : {}),
      maxRunChildren: MAX_TEAM_MEMBERS,
    })
    if (override) {
      await setSessionLlmOverride(res.id, override)
        .then((ok) => {
          if (ok) emit('session.llm-override', { sessionId: res.id, llmOverride: override })
        })
        .catch((err) => {
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
