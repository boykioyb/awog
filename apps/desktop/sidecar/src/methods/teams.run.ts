import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadTeam, MAX_TEAM_MEMBERS } from '../teams/store.js'
import {
  createSession,
  flushSession,
  setSessionAgent,
} from '../sessions/store.js'
import { mintSessionId } from '../sessions/spawn.js'
import { postSessionMessage } from '../sessions/inbox.js'
import { log } from '../util/logger.js'
import { emit } from '../transport/stdio.js'
import type { Session, SessionAgentRef, SessionSettings, SessionSummary } from '../types/shared.js'

// teams.run — MATERIALIZE một team spec thành PHIÊN LEAD (session-teams §9,
// kiểu "giao issue cho squad" của Multica):
//
//   1. Tạo phiên GỐC (lead) trên project đích — tin hộp thư của member tự
//      giao+chạy theo cơ chế auto-deliver chung của renderer.
//   2. Bind team.lead lên gốc qua sessions.setAgent (vai "có thật").
//   3. Member KHÔNG spawn trước: lead nhận một briefing kèm roster của spec,
//      và phiên của một member chỉ materialize khi có VIỆC THẬT được giao cho
//      member đó (`assignee_member` của team_item_create/update →
//      spawnChildSession đúng đường spawn đã có — kế thừa settings của gốc,
//      emit session.created, gửi prompt đầu qua hộp thư). Một run bắt đầu
//      không đốt một lượt nào cho member chưa có việc.
//
// Spec ở hai tầng (global/project); project ĐÍCH của cây phiên là tham số
// riêng — team global có thể giao việc cho bất kỳ project nào.

const SettingsSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']),
  modelId: z.string().min(1).max(200),
  level: z.enum(['low', 'medium', 'high', 'extra-high', 'max']).optional(),
  mode: z.enum(['ask', 'accept-edits', 'plan', 'execute']).optional(),
  accountId: z.string().max(64).optional(),
})

const Params = z.object({
  id: z.string().min(1).max(64),
  source: z.enum(['global', 'project']).default('global'),
  // Project sở hữu SPEC khi source=project.
  teamProjectId: z.string().min(1).max(64).optional(),
  // Project ĐÍCH mà cây phiên chạy trên — board/worktree của nhóm theo project
  // này. null = phiên không gắn project (team chạy "loose", không board).
  projectId: z.string().min(1).max(64).nullable(),
  // Settings của phiên gốc — UI gửi defaults hiện tại của người dùng (giống
  // đường tạo phiên thường); member kế thừa qua spawnChildSession.
  settings: SettingsSchema,
})

const THINKING_DEFAULT = 'high' as const
const MODE_DEFAULT = 'execute' as const

register('teams.run', async (raw) => {
  const params = Params.parse(raw)
  const team = await loadTeam(params.id, params.source, params.teamProjectId)
  if (!team) {
    throw new RpcError(-32004, `Team not found: ${params.id}`, { code: 'unknown-team' })
  }
  // Preflight TRƯỚC khi tạo phiên: lỗi ở đây phải bỏ qua được mà không để lại
  // cây mồ côi. Cap khớp teams.upsert (MAX_TEAM_MEMBERS) — spec ghi được thì
  // phải chạy được; trước đây trần spawn 12 nuốt mọi spec > 12 member dưới dạng
  // "Internal error" VÀ vẫn cố tạo phiên lead trước khi fail.
  if (team.members.length > MAX_TEAM_MEMBERS) {
    throw new RpcError(
      -32000,
      `Team "${team.name}" has ${team.members.length} members, over the limit of ${MAX_TEAM_MEMBERS}. Trim the spec and try again.`,
    )
  }

  const now = new Date().toISOString()
  const rootId = mintSessionId()
  const settings: SessionSettings = {
    provider: params.settings.provider,
    modelId: params.settings.modelId,
    level: params.settings.level ?? THINKING_DEFAULT,
    mode: params.settings.mode ?? MODE_DEFAULT,
    ...(params.settings.accountId ? { accountId: params.settings.accountId } : {}),
  }
  const root: Session = {
    id: rootId,
    title: team.name,
    projectId: params.projectId,
    createdAt: now,
    updatedAt: now,
    invitedAgentIds: [],
    messages: [],
    pendingAgentIds: [],
    settings,
    // Link ngược về spec — trang Team nhận diện các run của mình qua field này.
    // teamSource/teamProjectId ghi kèm để materialize member LƯỜI (board-tools)
    // resolve đúng file spec, kể cả khi id trùng giữa hai tier.
    teamId: team.id,
    teamSource: team.source ?? 'global',
    ...(team.source === 'project' && team.projectId
      ? { teamProjectId: team.projectId }
      : {}),
  }
  await createSession(root)

  // Bind agent lead TRƯỚC khi emit — `session.created` mang nguyên summary đã
  // có agent, renderer không cần event thứ hai để thấy "vai có thật".
  const leadRef: SessionAgentRef | undefined = team.lead
  if (leadRef) await setSessionAgent(rootId, leadRef)

  const summary: SessionSummary = {
    id: rootId,
    title: root.title,
    projectId: root.projectId,
    createdAt: now,
    updatedAt: now,
    status: 'idle',
    invitedAgentIds: [],
    pendingAgentIds: [],
    settings,
    messageCount: 0,
    teamId: team.id,
    teamSource: team.source ?? 'global',
    ...(team.source === 'project' && team.projectId
      ? { teamProjectId: team.projectId }
      : {}),
    ...(leadRef ? { agent: leadRef } : {}),
  }
  emit('session.created', { session: summary })
  await flushSession(rootId)

  // Briefing GỐC (khuôn Multica) — một tin duy nhất vào inbox của lead, gồm:
  //   • chỉ dẫn cấp đội của spec (nếu có);
  //   • ROSTER member — spawn LƯỜI: một member chỉ có phiên khi được giao một
  //     board item (assignee_member của team_item_create/update). Không spawn
  //     sẵn — run bắt đầu không đốt lượt nào cho member chưa có việc.
  const roster =
    team.members.length > 0
      ? team.members
          .map((m) => `- "${m.title}"${m.agent?.id ? ` · agent ${m.agent.id}` : ''}`)
          .join('\n')
      : '(no members in the spec — the lead may still spawn ad-hoc sessions with create_session when the work calls for it)'
  await postSessionMessage({
    from: null,
    to: rootId,
    text:
      `Team "${team.name}" — you are its lead.` +
      (team.instructions?.trim()
        ? `\n\nOperating instructions:\n${team.instructions.trim()}`
        : '') +
      `\n\nMember roster (spawned lazily — a member's session only exists once work is assigned to them):\n${roster}\n\n` +
      'To dispatch: assign a board item to a member by title via assignee_member on team_item_create/team_item_update — that member\'s session spawns on the assignment and is woken with the item. Never materialize members ahead of need. ' +
      'A member title is a ROLE: member_instance:<N≥2> seats a parallel instance of it ("Dev 2" — a second Dev for an independent workstream) when one member would otherwise serialize the work.',
  }).catch((err) =>
    log.warn('teams.run: could not deliver lead briefing', {
      err: err instanceof Error ? err.message : String(err),
    }),
  )

  // Không member nào được spawn ở đây — kết quả trả roster để caller biết spec
  // có bao nhiêu người (mỗi người sẽ thành phiên khi được giao việc).
  return {
    rootId,
    members: [],
    failed: [],
    roster: team.members.map((m) => ({ title: m.title, agentId: m.agent?.id ?? null })),
  }
})
