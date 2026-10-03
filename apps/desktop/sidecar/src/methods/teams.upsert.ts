import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadTeam, MAX_TEAM_MEMBERS, saveTeam } from '../teams/store.js'
import type { TeamSpec } from '../types/shared.js'

// Tạo/sửa một team spec (session-teams §9). Team là spec BỀN — upsert chỉ ghi
// hồ sơ đội (tên + lead + member agent refs), KHÔNG đụng cây phiên nào;
// materialize là đường `teams.run`.
const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]*$/i

const AgentRef = z.object({
  id: z.string().min(1).max(120),
  source: z.enum(['global', 'project']).optional(),
  projectId: z.string().min(1).max(64).optional(),
})

const TeamSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  desc: z.string().max(2000).optional(),
  // Chỉ dẫn cấp đội — chỉ đưa cho lead khi materialize (khuôn Multica).
  instructions: z.string().max(8000).optional(),
  lead: AgentRef.optional(),
  members: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        agent: AgentRef.optional(),
      }),
    )
    .max(MAX_TEAM_MEMBERS),
  source: z.enum(['global', 'project']).optional(),
  projectId: z.string().min(1).max(64).optional(),
})

const Params = z.object({ team: TeamSchema })

register('teams.upsert', async (raw) => {
  const { team } = Params.parse(raw)
  // Validate nhẹ agent refs — trần charset khớp các đường bind khác.
  const refs = [team.lead, ...team.members.map((m) => m.agent)].filter(Boolean)
  for (const r of refs) {
    if (r && !AGENT_ID_RE.test(r.id)) {
      throw new RpcError(-32602, `Invalid agent id: ${r.id}`)
    }
  }
  // Giữ createdAt của bản ghi cũ khi đè — spec bền có lịch sử.
  const existing = await loadTeam(team.id, team.source ?? 'global', team.projectId)
  const now = new Date().toISOString()
  // exactOptionalPropertyTypes: dựng lại object bỏ hẳn key vắng mặt (khuôn
  // toSessionSettings của sessions.upsert) thay vì spread nguyên parse.
  const spec: TeamSpec = {
    id: team.id,
    name: team.name,
    members: team.members.map((m) => ({
      title: m.title,
      ...(m.agent ? { agent: m.agent } : {}),
    })),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  if (team.desc !== undefined) spec.desc = team.desc
  if (team.instructions !== undefined) spec.instructions = team.instructions
  if (team.lead !== undefined) spec.lead = team.lead
  if (team.source !== undefined) spec.source = team.source
  if (team.projectId !== undefined) spec.projectId = team.projectId
  await saveTeam(spec)
  return { team: spec }
})
