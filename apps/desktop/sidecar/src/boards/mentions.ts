// @MENTION trong comment của một board item (docs/features/session-teams.md §7):
// người dùng gõ "@ten-agent nhận việc" trong thread và kỳ vọng đúng người đó
// được gọi dậy — trước đây comment chỉ wake ASSIGNEE nên mention rơi vào hư
// không khi item chưa có chủ. File này gom hai việc:
//
//   1. RESOLVE một handle (@product-delivery-team-lead) thành một đích có thật:
//      phiên đang sống board-capable → member trên "bench" của run item →
//      agent spec → team spec. Không khớp thì bỏ — "@cái-gì-đó" có thể chỉ là
//      chữ, không phải lời gọi.
//   2. MATERIALIZE spec thành phiên bằng đúng các đường dispatch sẵn có
//      (agents.run / teams.run / sessions.materializeMember qua dispatch nội
//      bộ — khuôn schedules/runner gọi dispatch), kèm settings hiệu dụng
//      mirror `dispatchRunSettings` phía UI.
//
// Phần THUẦN (parse handle, match trong danh sách có sẵn) tách khỏi phần EFFECT
// (spawn/ping) để test được không cần mock filesystem.

import { listAgents, loadAgent } from '../agents/store.js'
import { listTeams, loadTeam } from '../teams/store.js'
import { loadProject } from '../projects/store.js'
import { resolveSettings } from '../settings/store.js'
import { dispatch } from '../transport/rpc.js'
import { findSpecMember, loadRunTeam } from '../sessions/team-members.js'
import { runRootId } from '../sessions/run-root.js'
import { setSessionLlmOverride } from '../sessions/store.js'
import { log } from '../util/logger.js'
import type {
  Agent,
  AgentSource,
  BoardItem,
  SessionLlmOverride,
  SessionSummary,
  TeamSpec,
} from '../types/shared.js'

// Trần mention xử lý mỗi comment — mỗi cái có thể tốn một spawn, không để một
// comment spam cả một đội quân.
export const MAX_MENTIONS_PER_COMMENT = 3

// Handle mà composer insert: slug của tên agent (agentHandle bên UI:
// name.toLowerCase().replace(/\s+/g,'-')) — chỉ đổi KHOẢNG TRẮNG, còn '/',
// '—', '&' giữ nguyên ("QA/QC — Testing & Automation" → "@qa/qc-—-testing-&-
// automation"). Vì vậy canonical ở đây gấp MỌI cụm ký tự không phải
// chữ-số về một gạch: token quét được lẫn candidate đi qua cùng `canon` nên
// "@qa/qc-—-testing-&-automation" ≡ slug "qa-qc-testing-automation" ≡ đuôi
// agent.id của seat. Token chứa ':' hoặc '.' vẫn bị loại —
// '@skill:x' và '@đường/dẫn/file.md' là ref loại khác, không phải lời gọi.
const MENTION_TOKEN_RE = /(?:^|\s)@([^\s@]{1,64})/gu

const stripMarks = (s: string): string => s.normalize('NFD').replace(/\p{Diacritic}/gu, '')
const canon = (s: string): string =>
  stripMarks(s.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
const slug = canon

// Quét text → danh sách handle unique (giữ thứ tự xuất hiện, trần
// MAX_MENTIONS_PER_COMMENT). Trả về dạng canonical: lowercase + bỏ dấu +
// gấp ký tự lạ về '-'.
export function mentionHandles(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(MENTION_TOKEN_RE)) {
    const raw = m[1] ?? ''
    if (!/^[\p{L}\p{N}]/u.test(raw) || raw.includes(':') || raw.includes('.')) continue
    const h = canon(raw)
    if (!h || seen.has(h)) continue
    seen.add(h)
    out.push(h)
    if (out.length >= MAX_MENTIONS_PER_COMMENT) break
  }
  return out
}

// Project mà một phiên "sống" trên — member kế thừa của gốc (cùng quy tắc
// resolveRunContext của board-tools) nên title mention của member thiếu
// projectId vẫn match được.
function sessionProject(s: SessionSummary, summaries: SessionSummary[]): string | null {
  if (s.projectId) return s.projectId
  const root = s.teamRunId ? summaries.find((x) => x.id === s.teamRunId) : undefined
  return root?.projectId ?? null
}

// Phiên có board tools hay không — nhắc một phiên chat thường chỉ làm nó trả
// lời "tôi không có team_item_*" (member của run / gốc teamId / board-worker
// origin 'board' mới đủ cổng — mirror điều kiện resolveRunContext).
function boardCapable(s: SessionSummary, summaries: SessionSummary[]): boolean {
  if (s.archived) return false
  if (s.origin === 'board' && s.projectId) return true
  return runRootId(summaries, s.id) !== null
}

// Phiên sống khớp handle — CÙNG project của item (mention là về item này, gọi
// nhầm một phiên đang làm việc của project khác chỉ là nhiễu). Match theo
// title-slug, id phiên, hoặc id của agent bind — hai lượt: khớp CHÍNH XÁC
// trước, rồi mới đuôi agent.id ('-'+handle). Đuôi bắt handle dạng slug-tên-
// agent ("product-delivery-team-lead") vì agent.id của seat team là
// '<team-slug>-<role-slug>'; xếp sau vòng exact để một phiên match tròn luôn
// thắng suffix mơ hồ của phiên khác.
export function matchLiveSession(
  handle: string,
  summaries: SessionSummary[],
  projectId: string,
): SessionSummary | undefined {
  const candidates = summaries.filter(
    (s) => sessionProject(s, summaries) === projectId && boardCapable(s, summaries),
  )
  return (
    candidates.find(
      (s) => s.id === handle || slug(s.title || '') === handle || s.agent?.id === handle,
    ) ??
    candidates.find((s) => !!s.agent?.id && canon(s.agent.id).endsWith(`-${handle}`))
  )
}

// Spec agent khớp handle — project-tier shadow global trùng id (quy ước Claude
// Code, cùng picker "giao cho" của editor). Trả spec theo đúng thứ tự ưu tiên.
export function matchAgentSpec(
  handle: string,
  agents: Agent[],
  projectId: string,
): Agent | undefined {
  const usable = agents.filter(
    (a) => (a.source ?? 'global') === 'global' || a.projectId === projectId,
  )
  const matches = usable.filter((a) => a.id === handle || slug(a.name) === handle)
  return (
    matches.find((a) => a.source === 'project' && a.projectId === projectId) ??
    matches.find((a) => (a.source ?? 'global') === 'global')
  )
}

// Spec team khớp handle — cùng luật scope/shadow của agent.
export function matchTeamSpec(
  handle: string,
  teams: TeamSpec[],
  projectId: string,
): TeamSpec | undefined {
  const matches = teams.filter(
    (t) =>
      (t.source ?? 'global') === 'global' || (t.source === 'project' && t.projectId === projectId),
  )
  return matches.find((t) => t.id === handle || slug(t.name) === handle)
}

// Run mà item thuộc về (để resolve "bench" member chưa có phiên): qua assignee
// đang sống của item (member → cha, lead → chính nó) hoặc qua assigneeRef dạng
// 'member:<runId>|<title>' đang đỗ. Item mồ côi không run ⇒ không có bench.
export async function itemRunRoot(
  summaries: SessionSummary[],
  item: BoardItem,
): Promise<SessionSummary | null> {
  const aid = item.assigneeSessionId
  if (aid && aid !== 'user') {
    const r = runRootId(summaries, aid)
    if (r) return summaries.find((s) => s.id === r) ?? null
  }
  const ref = item.assigneeRef
  if (ref?.startsWith('member:')) {
    const sep = ref.indexOf('|')
    const runId = ref.slice(7, sep > 0 ? sep : undefined)
    return summaries.find((s) => s.id === runId) ?? null
  }
  return null
}

// Handle trỏ vào LEAD của run: 'lead' trần · '<slug-tên-team>-lead' ·
// '<slug-title-root>-lead' · agent.id của root (nguyên văn hoặc đuôi '-'+h).
// Title phiên của lead thường chỉ là TÊN TEAM ("Product Delivery Team") còn
// handle composer chèn là slug tên AGENT ("product-delivery-team-lead") nên
// đường matchLiveSession thường không chạm được — nếu rớt xuống matchAgentSpec
// thì mention SPAWN một phiên lead thứ hai song song với lead thật đang sống.
export function leadHandle(
  handle: string,
  root: SessionSummary,
  team: TeamSpec | null,
): boolean {
  if (handle === 'lead') return true
  const aid = root.agent?.id
  if (aid && (aid === handle || canon(aid).endsWith(`-${handle}`))) return true
  return [team?.name, root.title]
    .filter((b): b is string => !!b)
    .some((b) => `${slug(b)}-lead` === handle)
}

// ─── Materialize ─────────────────────────────────────────────────────────────

// Settings hiệu dụng khi DISPATCH một phiên từ trong sidecar — mirror
// `dispatchRunSettings` của renderer (spec pin → project.llmDefaults →
// defaults global). Provider/model là bắt buộc của schema agents.run/teams.run
// nên có fallback cứng khớp DEFAULT_MODEL của task engine.
interface SpecPin {
  provider?: Agent['provider'] | undefined
  model?: string | undefined
  accountId?: string | undefined
}
async function dispatchSettings(projectId: string, spec?: SpecPin) {
  const defaults = ((await resolveSettings(projectId)).effective['defaults'] ?? {}) as {
    provider?: 'anthropic' | 'openai' | 'google'
    modelId?: string
    thinkingLevel?: 'low' | 'medium' | 'high' | 'extra-high' | 'max'
    mode?: 'ask' | 'accept-edits' | 'plan' | 'execute'
  }
  const ld = (await loadProject(projectId))?.llmDefaults
  const provider = spec?.provider ?? ld?.provider ?? defaults.provider ?? 'anthropic'
  const accountId =
    spec?.accountId ??
    (ld?.accountId && (!ld.provider || ld.provider === provider) ? ld.accountId : undefined)
  return {
    provider,
    modelId: spec?.model ?? ld?.modelId ?? defaults.modelId ?? 'claude-opus-5',
    level: ld?.level ?? defaults.thinkingLevel ?? 'high',
    mode: defaults.mode ?? 'execute',
    ...(accountId ? { accountId } : {}),
  }
}

// Một đích đã resolve thành sessionId — ping sau bởi caller.
export interface MentionTarget {
  sessionId: string
  title: string
  // 'session' = đã sống; các loại còn lại vừa được materialize cho mention này.
  kind: 'session' | 'member' | 'agent' | 'team'
  spawned: boolean
}

// Spawn một spec thành phiên và trả target. `assigning` chỉ đổi nhịp prompt/
// title của phiên mới (tin đầu inbox của member materialize chính là lời giao
// việc; session title theo item chỉ hợp khi nó là chủ việc). Lỗi spawn trả
// null + warn — mention tắc không được làm hỏng comment đã ghi.
async function spawnTarget(
  item: BoardItem,
  member: { runId: string; title: string } | Agent | TeamSpec,
  kind: 'member' | 'agent' | 'team',
  assigning: boolean,
): Promise<MentionTarget | null> {
  try {
    if (kind === 'member') {
      const m = member as { runId: string; title: string }
      const res = (await dispatch('sessions.materializeMember', {
        rootId: m.runId,
        member: m.title,
        ...(assigning ? { itemTitle: item.title, itemId: item.id } : {}),
      })) as { sessionId?: string }
      return res?.sessionId
        ? { sessionId: res.sessionId, title: m.title, kind, spawned: true }
        : null
    }
    if (kind === 'agent') {
      const a = member as Agent
      const res = (await dispatch('agents.run', {
        agent: {
          id: a.id,
          source: a.source ?? 'global',
          ...(a.source === 'project' && a.projectId ? { projectId: a.projectId } : {}),
        },
        projectId: item.projectId,
        settings: await dispatchSettings(item.projectId, a),
        // Quy ước board dispatch: phiên nhận title = title VIỆC khi nó là chủ;
        // mention-tham-gia giữ tên agent.
        ...(assigning ? { title: item.title } : {}),
        origin: 'board',
      })) as { sessionId?: string }
      return res?.sessionId
        ? { sessionId: res.sessionId, title: a.name, kind, spawned: true }
        : null
    }
    const t = member as TeamSpec
    const res = (await dispatch('teams.run', {
      id: t.id,
      source: t.source ?? 'global',
      ...(t.source === 'project' && t.projectId ? { teamProjectId: t.projectId } : {}),
      projectId: item.projectId,
      settings: await dispatchSettings(item.projectId),
    })) as { rootId?: string }
    return res?.rootId ? { sessionId: res.rootId, title: t.name, kind, spawned: true } : null
  } catch (err) {
    log.warn('boards mention: spawn failed', {
      kind,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// Resolve MỘT handle thành target, theo thứ tự: phiên sống (đừng spawn bản
// sao) → bench member của run item → agent spec → team spec. `assigning` truyền
// xuống spawnTarget cho nhịp prompt/title của phiên mới. Tham số lists được
// caller nạp một lần rồi tái dùng cho mọi handle (agent/team roster không đổi
// giữa các mention).
export async function resolveMentionTarget(
  handle: string,
  ctx: {
    item: BoardItem
    summaries: SessionSummary[]
    agents: Agent[]
    teams: TeamSpec[]
    assigning: boolean
  },
): Promise<MentionTarget | null> {
  const { item, summaries } = ctx
  // Root của run item đứng TRƯỚC mọi match: khi handle là của lead thì đích là
  // chính lead đang sống của run đó — kể cả khi một phiên khác cũng suffix-
  // khớp agent.id (bản sao do mention cũ spawn trước khi có luật này).
  const root = await itemRunRoot(summaries, item)
  const team = root ? await loadRunTeam(root) : null
  if (root && leadHandle(handle, root, team)) {
    return {
      sessionId: root.id,
      title: root.title || root.id,
      kind: 'session',
      spawned: false,
    }
  }
  const live = matchLiveSession(handle, summaries, item.projectId)
  if (live) {
    return {
      sessionId: live.id,
      title: live.title || live.id,
      kind: 'session',
      spawned: false,
    }
  }
  if (root && team) {
    // findSpecMember so lowercase trần — handle canon ("qa-qc-testing-…") của
    // member có tên đặc ký ("QA/QC — Testing & Automation") sẽ trượt, nên rà
    // thêm một lượt canon/title + đuôi agent.id trước khi rớt xuống spec.
    const member =
      findSpecMember(team, handle) ??
      team.members.find(
        (m) =>
          canon(m.title) === handle ||
          (!!m.agent?.id && canon(m.agent.id).endsWith(`-${handle}`)),
      )
    if (member) {
      return await spawnTarget(
        item,
        { runId: root.id, title: member.title },
        'member',
        ctx.assigning,
      )
    }
  }
  const agent = matchAgentSpec(handle, ctx.agents, item.projectId)
  if (agent) return await spawnTarget(item, agent, 'agent', ctx.assigning)
  const teamSpec = matchTeamSpec(handle, ctx.teams, item.projectId)
  if (teamSpec) return await spawnTarget(item, teamSpec, 'team', ctx.assigning)
  return null
}

// Nạp roster spec một lần cho cả comment — projectIds = đúng project của item
// (global luôn đi kèm trong kết quả listAgents/listTeams).
export async function loadMentionRosters(
  projectId: string,
): Promise<{ agents: Agent[]; teams: TeamSpec[] }> {
  const [{ agents }, teams] = await Promise.all([listAgents([projectId]), listTeams([projectId])])
  return { agents, teams }
}

// ─── Spec người nhận đang đỗ (assigneeRef) ────────────────────────────────────
//
// Ref = sentinel của picker "giao cho", format như renderer:
//   'member:<runId>|<title>'                — bench member của một run đang sống
//   'agent:<source>|<projectId|rỗng>|<id>'  — agent spec (projectId rỗng khi global)
//   'team:<source>|<projectId|rỗng>|<id>'   — team spec
//
// Người dùng gán ref lúc tạo item (backlog-first, không spawn). Khi họ COMMENT
// trên item, spec phải thành phiên để trả lời được — mirror materializeRef của
// stores/board.ts, gồm cả các slot assigneeConfig ('self'/'lead'/'member:*').
// Item CHƯA gán sessionId nhưng có ref mà comment tới ⇒ đây là đích wake
// chính, trước cả @mention (ref là lời gán của chính người dùng).

// Parse '<source>|<projectId|rỗng>|<id>' — projectId rỗng = spec global.
function parseRefKey(
  ref: string,
): { source: AgentSource; projectId: string | undefined; id: string } | null {
  const key = ref.slice(ref.indexOf(':') + 1)
  const parts = key.split('|')
  if (parts.length !== 3) return null
  const [source, projectId, id] = parts
  if ((source !== 'global' && source !== 'project') || !id) return null
  return { source, projectId: projectId || undefined, id }
}

// Override của một slot → patch vào settings spawn (provider/model/account như
// renderer; level+mode đi qua setSessionLlmOverride vì đó là tầng thắng pin của
// agent spec).
function mergeSpawnSettings(
  settings: Awaited<ReturnType<typeof dispatchSettings>>,
  ov: SessionLlmOverride | undefined,
): typeof settings {
  if (!ov) return settings
  return {
    ...settings,
    ...(ov.provider ? { provider: ov.provider } : {}),
    ...(ov.modelId ? { modelId: ov.modelId } : {}),
    ...(ov.accountId ? { accountId: ov.accountId } : {}),
  }
}

async function applyLlmOverride(sessionId: string, ov: SessionLlmOverride | undefined) {
  if (!ov) return
  await setSessionLlmOverride(sessionId, ov).catch((err) => {
    log.warn('boards mention: llmOverride write failed', {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    })
  })
}

// Materialize `item.assigneeRef` thành phiên. Trả null khi ref không parse
// được/spec đã xoá/spawn hỏng — caller rơi về đường @mention/'none'.
export async function materializeAssigneeRef(item: BoardItem): Promise<MentionTarget | null> {
  const ref = item.assigneeRef
  if (!ref) return null
  const config = item.assigneeConfig ?? {}
  try {
    if (ref.startsWith('member:')) {
      const sep = ref.indexOf('|')
      if (sep < 0) return null
      const title = ref.slice(sep + 1)
      const res = (await dispatch('sessions.materializeMember', {
        rootId: ref.slice(7, sep),
        member: title,
        itemTitle: item.title,
        itemId: item.id,
        ...(config[`member:${title}`] ? { llmOverride: config[`member:${title}`] } : {}),
      })) as { sessionId?: string }
      return res?.sessionId
        ? { sessionId: res.sessionId, title, kind: 'member', spawned: true }
        : null
    }
    if (ref.startsWith('team:')) {
      const key = parseRefKey(ref)
      if (!key) return null
      const t = await loadTeam(key.id, key.source, key.projectId)
      if (!t) return null
      const leadOv = config['lead']
      const res = (await dispatch('teams.run', {
        id: t.id,
        source: t.source ?? 'global',
        ...(t.source === 'project' && t.projectId ? { teamProjectId: t.projectId } : {}),
        projectId: item.projectId,
        settings: mergeSpawnSettings(await dispatchSettings(item.projectId), leadOv),
      })) as { rootId?: string }
      if (!res?.rootId) return null
      await applyLlmOverride(res.rootId, leadOv)
      return {
        sessionId: res.rootId,
        title: t.name,
        kind: 'team',
        spawned: true,
      }
    }
    if (!ref.startsWith('agent:')) return null
    const key = parseRefKey(ref)
    if (!key) return null
    const a = await loadAgent(key.id, key.source, key.projectId)
    if (!a) return null
    const selfOv = config['self']
    const res = (await dispatch('agents.run', {
      agent: {
        id: a.id,
        source: a.source ?? 'global',
        ...(a.source === 'project' && a.projectId ? { projectId: a.projectId } : {}),
      },
      projectId: item.projectId,
      settings: mergeSpawnSettings(
        await dispatchSettings(item.projectId, {
          provider: a.provider,
          model: a.model,
          accountId: a.accountId,
        }),
        selfOv,
      ),
      title: item.title,
      origin: 'board',
    })) as { sessionId?: string }
    if (!res?.sessionId) return null
    await applyLlmOverride(res.sessionId, selfOv)
    return {
      sessionId: res.sessionId,
      title: a.name,
      kind: 'agent',
      spawned: true,
    }
  } catch (err) {
    log.warn('boards mention: assigneeRef materialize failed', {
      ref,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
