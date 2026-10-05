// teams.draft — one-shot LLM dựng/chỉnh một TeamSpec từ mô tả người dùng
// ("create/update with agent" của trang Teams). Khuôn agents.generate: model
// trả MỘT JSON object spec, sidecar sanitize + chối agent ref lạ trước khi trả
// về cho editor (người dùng duyệt rồi mới upsert — draft không ghi đĩa).
//
// Roster agent (danh sách id hợp lệ) do UI truyền kèm: spec chỉ được bind tới
// AGENT.md đang tồn tại; model chọn theo id, những field còn lại của ref
// (source/projectId) được khôi phục từ roster — model không bịa source.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import { completePi } from '../runtime/complete.js'
import { MAX_TEXT_LEN, oneLineLabel } from '../sessions/inbox.js'
import type { ProviderName, SessionAgentRef, TeamSpec } from '../types/shared.js'

const AgentRef = z.object({
  id: z.string().min(1).max(64),
  source: z.enum(['global', 'project']).optional(),
  projectId: z.string().min(1).max(64).optional(),
})

// name/description chỉ là gợi ý hiển thị cho model (đã slice khi render roster)
// — trần rộng để agent có mô tả dài không làm hỏng validation; id/projectId
// theo trần SessionAgentRef.
const RosterEntry = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(240).optional(),
  description: z.string().max(4000).optional(),
  source: z.enum(['global', 'project']).optional(),
  projectId: z.string().min(1).max(64).optional(),
})

const CurrentTeam = z.object({
  name: z.string().max(120),
  desc: z.string().max(2000).optional(),
  instructions: z.string().max(8000).optional(),
  lead: AgentRef.optional(),
  members: z
    .array(z.object({ title: z.string().max(80), agent: AgentRef.optional() }))
    .max(24),
})

const Params = z.object({
  brief: z.string().min(1).max(MAX_TEXT_LEN),
  // Có mặt ⇒ revise spec hiện tại (update-with-agent); vắng mặt ⇒ draft mới.
  current: CurrentTeam.optional(),
  // Roster agent được phép bind — model chỉ chọn id trong danh sách này.
  // UI gửi roster của MỌI project đã link + global (dễ vài chục entry) —
  // trần phải đủ rộng; prompt vẫn gọn vì mỗi entry render ~1 dòng.
  agents: z.array(RosterEntry).max(256).default([]),
  settings: z.object({
    provider: z.enum(['anthropic', 'openai', 'google']),
    modelId: z.string().min(1).max(200),
    accountId: z.string().max(64).optional(),
  }),
})

// Trần hiển thị khớp TeamSchema của teams.upsert — draft qua tay UI cũng phải
// qua được RPC đó.
const MAX_NAME = 120
const MAX_DESC = 2000
const MAX_TITLE = 80
const MAX_MEMBERS = 24

const SYS = `You design team specs for AWOG, a local-first AI team OS. A "team" is a persistent spec: a lead session per run, and member sessions materialized lazily — each spawns on its first work assignment.

Output ONLY a JSON object — no prose, no markdown fence:
{"name": "…", "desc": "…", "instructions": "…", "leadId": "…" | null, "members": [{"title": "…", "agentId": "…" | null}]}

Rules:
- name: max 120 chars, short display name (e.g. "Auth Squad").
- desc: one line, what this team owns. Omit when nothing useful.
- instructions: routing rules + collaboration norms given to the LEAD only
  (e.g. "route backend work to Dev, review goes to Reviewer"). Omit when the
  request gives no guidance.
- leadId: id from the PROVIDED ROSTER for the coordinator role, or null when no roster agent fits.
- members: 0 to 8 rows. title = session title shown to the user (e.g. "Dev — Auth"), max 80 chars.
- agentId: id from the PROVIDED ROSTER, or null — never invent an id.
  PREFER binding a roster agent whose role/description fits the member; use
  null only when nothing in the roster fits — the app can auto-create a fresh
  agent for unbound members, so a null agentId means "no suitable agent exists".
- When a CURRENT spec is provided, revise it per the request — keep what isn't mentioned.
- Match the language of the request.`

// Cheap-per-provider (mirror sessions.spawn.ts) — không có bản rẻ thì thử
// thẳng model người dùng đang chọn.
const CHEAP_MODEL: Partial<Record<ProviderName, string>> = {
  anthropic: 'claude-haiku-4-5',
}

async function draftWithFallback(input: {
  provider: ProviderName
  modelId: string
  accountId?: string
  prompt: string
  systemPrompt?: string
  // Nhãn method trong log/lỗi — teams.draft hay teams.instructionsDraft.
  label?: string
}): Promise<string> {
  const label = input.label ?? 'teams.draft'
  const cheap = CHEAP_MODEL[input.provider]
  const candidates =
    cheap && cheap !== input.modelId ? [cheap, input.modelId] : [input.modelId]
  let lastErr = ''
  for (const modelId of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop -- intentional sequential fallback
      const out = await completePi({
        provider: input.provider,
        ...(input.accountId ? { accountId: input.accountId } : {}),
        modelId,
        systemPrompt: input.systemPrompt ?? SYS,
        prompt: input.prompt,
      })
      if (out.trim()) return out
      lastErr = 'empty response'
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
      log.warn(`${label} attempt failed`, { model: modelId, err: lastErr })
    }
  }
  // Surface the underlying cause (expired credential, quota, …) — "produced no
  // draft" alone sends the user debugging the model when it's usually auth.
  throw new RpcError(-32021, `${label}: model produced no draft${lastErr ? ` — ${lastErr}` : ''}`)
}

interface DraftShape {
  name?: unknown
  desc?: unknown
  instructions?: unknown
  leadId?: unknown
  members?: unknown
}

// Bóc object JSON ra khỏi output (chịu prose quanh object), sanitize từng
// field theo trần TeamSchema + chối agentId không có trong roster.
function parseDraft(raw: string, roster: Map<string, SessionAgentRef>): Partial<TeamSpec> | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let obj: DraftShape
  try {
    obj = JSON.parse(raw.slice(start, end + 1)) as DraftShape
  } catch {
    return null
  }
  const name = oneLineLabel(String(obj.name ?? ''), MAX_NAME)
  if (!name) return null
  const out: Partial<TeamSpec> & { name: string; members: TeamSpec['members'] } = {
    name,
    members: [],
  }
  const desc = oneLineLabel(String(obj.desc ?? ''), MAX_DESC)
  if (desc) out.desc = desc
  // instructions giữ nguyên xuống dòng (khác desc một dòng) — chỉ cắt trần.
  const instructions = typeof obj.instructions === 'string' ? obj.instructions.trim() : ''
  if (instructions) out.instructions = instructions.slice(0, 8000)
  if (typeof obj.leadId === 'string' && obj.leadId) {
    const ref = roster.get(obj.leadId)
    if (ref) out.lead = ref
  }
  const items = Array.isArray(obj.members) ? obj.members : []
  const seen = new Set<string>()
  for (const item of items.slice(0, MAX_MEMBERS)) {
    const it = item as Record<string, unknown>
    const title = oneLineLabel(String(it?.title ?? ''), MAX_TITLE)
    // Dedupe theo title — model đôi khi lặp một member ("thêm 1 QA" → 2 dòng QA).
    if (!title || seen.has(title)) continue
    seen.add(title)
    const member: TeamSpec['members'][number] = { title }
    if (typeof it?.agentId === 'string' && it.agentId) {
      const ref = roster.get(it.agentId)
      if (ref) member.agent = ref
    }
    out.members.push(member)
  }
  return out
}

register('teams.draft', async (raw) => {
  const params = Params.parse(raw)
  // Roster → map id → ref đầy đủ; id trùng thì bản project thắng (giống
  // thứ tự agents.list: project ghi đè global).
  const roster = new Map<string, SessionAgentRef>()
  for (const a of params.agents) {
    const ref: SessionAgentRef = { id: a.id }
    if (a.source) ref.source = a.source
    if (a.projectId) ref.projectId = a.projectId
    roster.set(a.id, ref)
  }

  const rosterText = params.agents.length
    ? params.agents
        .map((a) => `- ${a.id}${a.name ? ` (${a.name})` : ''}${a.description ? ` — ${a.description.slice(0, 120)}` : ''}`)
        .join('\n')
    : '(no agents registered — all agentIds must be null)'

  const body = [
    `Request: ${params.brief.trim()}`,
    '',
    `ROSTER (bindable agent ids):\n${rosterText}`,
    '',
    params.current
      ? `CURRENT spec (revise it, keep unmentioned parts):\n${JSON.stringify(params.current)}`
      : '',
    params.current ? 'Revise the spec now.' : 'Draft the spec now.',
  ]
    .filter(Boolean)
    .join('\n')

  const out = await draftWithFallback({
    provider: params.settings.provider,
    modelId: params.settings.modelId,
    ...(params.settings.accountId ? { accountId: params.settings.accountId } : {}),
    prompt: body,
  })
  const draft = parseDraft(out, roster)
  if (!draft) throw new RpcError(-32021, 'teams.draft: could not parse model output')
  return { draft }
})

// ── teams.instructionsDraft — AI chỉnh riêng ô "chỉ dẫn cấp đội" ────────────
// Khác teams.draft (revise cả spec): chỉ viết lại text instructions theo lời
// yêu cầu của user trong tab Instructions — trả text, editor đổ vào textarea
// và user duyệt/lưu như tay gõ.

const InstructionsParams = z.object({
  prompt: z.string().min(1).max(MAX_TEXT_LEN),
  // Instructions đang có — có thì model revise thay vì viết mới.
  current: z.string().max(8000).optional(),
  // Ngữ cảnh đội để model gọi đúng tên member/vai trò trong rule.
  context: z
    .object({
      name: z.string().max(120).optional(),
      desc: z.string().max(2000).optional(),
      members: z.array(z.string().max(80)).max(24).optional(),
    })
    .optional(),
  settings: z.object({
    provider: z.enum(['anthropic', 'openai', 'google']),
    modelId: z.string().min(1).max(200),
    accountId: z.string().max(64).optional(),
  }),
})

const INS_SYS = `You write "team instructions" for AWOG, a local-first AI team OS. Team instructions are routing rules and collaboration norms delivered ONLY to the team's lead session on each run — members never read them. The lead coordinates members on a shared kanban board (team_item_* tools: list/get/create/update/comment with assignee_member, member_instance, parent_id for sub-tasks) and a team channel (team_say for posts, member_diff to read a member's worktree diff).

Output ONLY the instructions text — no prose, no markdown fence, no heading, no JSON.

Rules:
- When CURRENT instructions are provided, revise them per the request — keep what isn't mentioned.
- Imperative and concrete: who may do what, routing rules, when to decompose into sub-tasks, review and escalation flow. Name real member titles when relevant.
- Under ~250 words unless the request asks for more.
- Match the language of the request.`

register('teams.instructionsDraft', async (raw) => {
  const params = InstructionsParams.parse(raw)
  const ctx = params.context
  const body = [
    ctx?.name ? `TEAM: ${ctx.name}${ctx.desc ? ` — ${ctx.desc}` : ''}` : '',
    ctx?.members?.length ? `MEMBERS:\n${ctx.members.map((m) => `- ${m}`).join('\n')}` : '',
    params.current?.trim()
      ? `CURRENT INSTRUCTIONS (revise, keep unmentioned rules):\n${params.current.trim()}`
      : '',
    `REQUEST:\n${params.prompt.trim()}`,
    'Write the instructions now.',
  ]
    .filter(Boolean)
    .join('\n\n')

  const out = await draftWithFallback({
    provider: params.settings.provider,
    modelId: params.settings.modelId,
    ...(params.settings.accountId ? { accountId: params.settings.accountId } : {}),
    prompt: body,
    systemPrompt: INS_SYS,
    label: 'teams.instructionsDraft',
  })
  // Model đôi khi vẫn bọc fence dù đã dặn — gỡ một lớp ngoài nếu có.
  let instructions = out.trim()
  const fence = instructions.match(/^```[a-z]*\n([\s\S]*?)\n?```$/)
  if (fence?.[1]) instructions = fence[1].trim()
  if (!instructions) throw new RpcError(-32021, 'teams.instructionsDraft: empty instructions')
  return { instructions: instructions.slice(0, 8000) }
})
