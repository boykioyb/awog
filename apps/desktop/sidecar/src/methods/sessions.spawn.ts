// RPC của popover ĐIỀU PHỐI phiên (sessions/spawn-approval.ts):
//
//   sessions.spawnResolve   — trả lời một `session.spawn-request` đang park:
//                             duyệt (kèm danh sách/cấu hình đã sửa) hay từ chối.
//   sessions.setSpawnConfig  — ghi nhớ / xoá cấu hình spawn trên gốc nhóm
//                             ("nhớ cho cả nhóm" ⇄ "ngừng điều phối").
//   sessions.spawnMembers  — đường THỦ CÔNG: menu ⋯ của một phiên mở cùng một
//                             popover, không qua tool `create_session` của model.
//
// Duyệt kèm `remember` ghi `spawnConfig` lên phiên GỐC của nhóm — lần
// `create_session` sau của nhóm này bỏ qua popover, đẻ thẳng theo cấu hình đã
// nhớ (xem spawn.ts/runRootOf). Ghi TRƯỚC khi request héo và emit
// `session.spawn-config` để mọi cửa sổ/popout hội tụ.
//
// Tin giao việc của phiên con tự giao+chạy theo cơ chế auto-deliver chung của
// renderer — không còn cờ hay cổng duyệt riêng cho việc đó.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { peekSpawnRequest, resolveSpawnRequest } from '../sessions/spawn-approval.js'
import {
  MAX_CHILDREN,
  MAX_ROLE_LEN,
  MAX_SPAWNS_PER_TURN,
  MAX_TITLE_LEN,
  SpawnError,
  runRootOf,
  spawnMemberSessions,
  // SpawnChildSpec của spawn.ts — bản có thêm tuple bind-agent của session-teams
  // (shared.ts thuộc track khác của feature này nên tuple chưa lên được đó).
  type SpawnChildSpec,
} from '../sessions/spawn.js'
import { MAX_TEXT_LEN, oneLineLabel } from '../sessions/inbox.js'
import {
  findSpecMember,
  loadMemberLlmOverride,
  loadRunTeam,
  materializeMember,
} from '../sessions/team-members.js'
import {
  listSessionSummaries,
  loadSession,
  setSessionSpawnConfig,
} from '../sessions/store.js'
import { listBoardItems } from '../boards/store.js'
import { emit } from '../transport/stdio.js'
import { completePi } from '../runtime/complete.js'
import { log } from '../util/logger.js'
import type { ProviderName, SpawnSessionConfig } from '../types/shared.js'

// Payload là L1 (IPC từ UI): id phiên đi vào sink đường dẫn nên bị siết đúng
// charset như `sessions.setGroup` / `sessions.delete`.
const SESSION_ID_RE = /^[a-z0-9-]+$/

// Khớp các field mà popover cho sửa — tập con có chủ đích của SessionSettings,
// y hệt SpawnSessionConfigSchema trong sessions.upsert.ts.
const SpawnConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']).optional(),
  modelId: z.string().max(200).optional(),
  accountId: z.string().max(64).optional(),
  level: z.enum(['low', 'medium', 'high', 'extra-high', 'max']).optional(),
  ultracode: z.boolean().optional(),
  mode: z.enum(['ask', 'accept-edits', 'plan', 'execute']).optional(),
  responseStyle: z.string().max(200).optional(),
  responseStyleNoMarkdown: z.boolean().optional(),
})

// Bộ đặc tả một phiên con: `config` là đè RIÊNG của phiên đó (đã trộn xong với
// cấu hình chung ở renderer), còn `config` ở tham số ngoài là cấu hình CHUNG —
// và cũng là thứ được ghi nhớ lên gốc khi `remember`.
const ChildSpecSchema = z.object({
  title: z.string().min(1).max(MAX_TITLE_LEN),
  role: z.string().max(MAX_ROLE_LEN).default(''),
  prompt: z.string().min(1).max(MAX_TEXT_LEN),
  config: SpawnConfigSchema.optional(),
  // Tuple bind agent (session-teams §3) — optional hết nên payload popover của
  // client cũ (chưa có picker agent) vẫn parse nguyên vẹn. Vắng = không bind.
  agentId: z.string().min(1).max(200).optional(),
  agentSource: z.enum(['global', 'project']).optional(),
  agentProjectId: z.string().min(1).max(200).optional(),
})

// exactOptionalPropertyTypes: dựng lại object chỉ với key thật sự có mặt —
// object rỗng hoàn toàn trả undefined: caller phải phân biệt "không gửi config"
// với "config rỗng". Riêng đường remember, `rememberSpawnConfig` cố ý đổi rỗng →
// `{}` (marker "đã duyệt điều phối, kế thừa hết") — xem comment tại đó.
function toSpawnConfig(
  parsed: z.infer<typeof SpawnConfigSchema> | undefined,
): SpawnSessionConfig | undefined {
  if (!parsed) return undefined
  const c: SpawnSessionConfig = {}
  if (parsed.provider !== undefined) c.provider = parsed.provider
  if (parsed.modelId !== undefined) c.modelId = parsed.modelId
  if (parsed.accountId !== undefined) c.accountId = parsed.accountId
  if (parsed.level !== undefined) c.level = parsed.level
  if (parsed.ultracode !== undefined) c.ultracode = parsed.ultracode
  if (parsed.mode !== undefined) c.mode = parsed.mode
  if (parsed.responseStyle !== undefined) c.responseStyle = parsed.responseStyle
  if (parsed.responseStyleNoMarkdown !== undefined) {
    c.responseStyleNoMarkdown = parsed.responseStyleNoMarkdown
  }
  return Object.keys(c).length ? c : undefined
}

// Chuẩn hoá children do zod parse: `config?: T | undefined` của zod không gán
// được vào `config?: T` (exactOptionalPropertyTypes) — key phải VẮNG hẳn. Tuple
// agent đi cùng luật: chỉ gắn key thật sự có mặt trên payload.
function toChildSpecs(
  parsed: z.infer<typeof ChildSpecSchema>[],
): SpawnChildSpec[] {
  return parsed.map((c) => {
    const { config, agentId, agentSource, agentProjectId, ...rest } = c
    const spec: SpawnChildSpec = { ...rest }
    const cfg = toSpawnConfig(config)
    if (cfg) spec.config = cfg
    if (agentId !== undefined) spec.agentId = agentId
    if (agentSource !== undefined) spec.agentSource = agentSource
    if (agentProjectId !== undefined) spec.agentProjectId = agentProjectId
    return spec
  })
}

// Ghi nhớ cấu hình spawn lên gốc nhóm khi `remember`. `remember` mà config rỗng
// (mọi field kế thừa) vẫn ghi `{}` — marker "đã duyệt rồi đừng hỏi nữa":
// runRootOf chỉ bỏ qua popover khi `spawnConfig` tồn tại, và config thiếu hẳn
// sẽ làm lời hứa "allow 1 lần" thất hứa lần sau. `setGroupSpawn` của
// session-manager coi `{}` là ghi, chỉ `null` mới là xoá.
// Emit SAU khi config đã nằm trên đĩa — renderer khác (kể cả popout) nhận đủ
// trạng thái một lần, không phải chờ reload mới thấy nhóm đã "nhớ".
async function rememberSpawnConfig(
  rootId: string,
  config?: SpawnSessionConfig,
): Promise<void> {
  const saved = config ?? {}
  await setSessionSpawnConfig(rootId, saved)
  emit('session.spawn-config', { sessionId: rootId, spawnConfig: saved })
}

// ─── sessions.spawnResolve ────────────────────────────────────────────────────

const ResolveParams = z.object({
  // spawn-approval.ts đúc id dạng `spawn-<hex>` — siết charset ngay tại cổng.
  requestId: z.string().regex(/^spawn-[a-f0-9]+$/),
  approved: z.boolean(),
  // Danh sách SAU chỉnh sửa trong popover. Vắng = giữ nguyên bản model đề xuất.
  children: z.array(ChildSpecSchema).max(MAX_CHILDREN).optional(),
  config: SpawnConfigSchema.optional(),
  remember: z.boolean().optional(),
  // Lời từ chối tự do — trả lại cho model đọc thay vì câu mặc định.
  message: z.string().max(500).optional(),
})

register('sessions.spawnResolve', async (raw) => {
  const params = ResolveParams.parse(raw)
  const parked = peekSpawnRequest(params.requestId)
  if (!parked) {
    // Request đã tan (lượt bị huỷ, cửa sổ kia đã trả lời): trả resolved:false
    // thay vì ném — cú bấm trễ là tình huống bình thường, không phải lỗi.
    return { resolved: false }
  }
  if (params.approved) {
    const config = toSpawnConfig(params.config)
    if (params.remember === true) await rememberSpawnConfig(parked.rootId, config)
    resolveSpawnRequest(params.requestId, {
      approved: true,
      ...(params.children ? { children: toChildSpecs(params.children) } : {}),
      ...(config ? { config } : {}),
      ...(params.remember !== undefined ? { remember: params.remember } : {}),
    })
  } else {
    resolveSpawnRequest(params.requestId, {
      approved: false,
      ...(params.message ? { message: params.message } : {}),
    })
  }
  return { resolved: true }
})

// ─── sessions.setSpawnConfig ───────────────────────────────────────────────────
// Ghi nhớ/xoá cấu hình spawn trên phiên GỐC. `config: null` = "ngừng điều phối"
// (xoá hẳn key — vì vậy phải là RPC riêng, patch spread không xoá được key).

const SetGroupSpawnParams = z.object({
  id: z.string().min(1).regex(SESSION_ID_RE),
  config: SpawnConfigSchema.nullable(),
})

register('sessions.setSpawnConfig', async (raw) => {
  const params = SetGroupSpawnParams.parse(raw)
  // Config sống trên GỐC nhóm — caller gửi id của một phiên CON thì phải leo lên
  // gốc, nếu không key được ghi nơi runRootOf không bao giờ tra.
  const root = runRootOf(await listSessionSummaries(), params.id)
  if (!root) throw new RpcError(-32004, 'Session not found')
  const saved = toSpawnConfig(params.config ?? undefined) ?? null
  const ok = await setSessionSpawnConfig(root.id, saved)
  if (!ok) throw new RpcError(-32004, 'Session not found')
  // Emit để cửa sổ khác (kể cả popout) hội tụ — `null` mang nghĩa XOÁ key,
  // renderer phân biệt với key vắng mặt (không đổi) bằng `'spawnConfig' in p`.
  emit('session.spawn-config', { sessionId: root.id, spawnConfig: saved })
  return { ok: true }
})

// ─── sessions.spawnMembers ───────────────────────────────────────────────────
// Đường thủ công từ menu ⋯ của một phiên: người dùng TỰ đề xuất ê-kíp trong
// popover thay vì model gọi `create_session`. Đã đi qua popover = đã được duyệt,
// nên đẻ ngay (remember tuỳ chọn thì ghi config lên gốc trước).

const SpawnChildrenParams = z.object({
  sessionId: z.string().min(1).regex(SESSION_ID_RE),
  children: z.array(ChildSpecSchema).min(1).max(MAX_CHILDREN),
  // Cấu hình CHUNG của lô — đã được renderer trộn vào từng `children[].config`
  // nếu có đè riêng; ở đây nó chỉ còn một việc: thứ ghi nhớ khi `remember`.
  config: SpawnConfigSchema.optional(),
  remember: z.boolean().optional(),
})

register('sessions.spawnMembers', async (raw) => {
  const params = SpawnChildrenParams.parse(raw)
  const root = runRootOf(await listSessionSummaries(), params.sessionId)
  if (!root) throw new RpcError(-32004, 'Session not found')
  const config = toSpawnConfig(params.config)
  if (params.remember === true) await rememberSpawnConfig(root.id, config)
  // KHÔNG throw khi lô hỏng: SpawnError (cha mất, chạm trần con) xếp vào
  // `failed` để UI báo theo từng con bằng toast sẵn có.
  try {
    return await spawnMemberSessions(params.sessionId, toChildSpecs(params.children))
  } catch (err) {
    // Lỗi lạ (không phải SpawnError) vẫn được log lại trước khi nuốt.
    if (!(err instanceof SpawnError)) {
      log.warn('spawnChildren failed unexpectedly', { err: String(err) })
    }
    return {
      created: [],
      failed: [{ title: '(spawn)', reason: err instanceof Error ? err.message : String(err) }],
    }
  }
})

// ─── sessions.materializeMember ───────────────────────────────────────────────
// Đường NGƯỜI DÙNG của dispatch-lười (đối xứng `assignee_member` mà lead dùng
// trong team_item_*): picker "giao cho" của board liệt kê cả member spec chưa
// có phiên ("bench") dưới khoá `member:<runId>|<title>`; khi item đi vào cột
// sống, renderer gọi RPC này → phiên của member đó materialize đúng một cái.
// `itemTitle`/`itemId` (khi có) làm tin đầu inbox THÀNH lời giao việc thật —
// giống prompt mà resolveMemberAssignee của board-tools dựng. Member đã sống
// ⇒ materializeMember tái dùng phiên, RPC trả sessionId của nó.

register('sessions.materializeMember', async (raw) => {
  const params = z
    .object({
      // Phiên GỐC của run (lead) — spec team resolve từ teamId của nó.
      rootId: z.string().min(1).regex(SESSION_ID_RE),
      // Title hoặc agent id của member trong spec — cùng miền findSpecMember.
      member: z.string().min(1).max(MAX_TITLE_LEN),
      itemTitle: z.string().max(200).optional(),
      itemId: z.string().max(64).optional(),
      // Override LLM của người dùng gửi THẲNG (editor truyền khi dispatch ngay —
      // item có thể chưa kịp ghi assigneeConfig). Vắng ⇒ tra lại trên item.
      llmOverride: z
        .object({
          provider: z.enum(['anthropic', 'openai', 'google']).optional(),
          modelId: z.string().min(1).max(200).optional(),
          accountId: z.string().min(1).max(64).optional(),
          level: z.enum(['low', 'medium', 'high', 'extra-high', 'max']).optional(),
          mode: z.enum(['ask', 'accept-edits', 'plan', 'execute']).optional(),
        })
        .optional(),
    })
    .parse(raw)
  const summaries = await listSessionSummaries()
  const root = summaries.find((s) => s.id === params.rootId)
  if (!root || root.archived) {
    throw new RpcError(-32004, 'Team run root session not found — it may have been deleted.')
  }
  const team = await loadRunTeam(root)
  if (!team) {
    throw new RpcError(-32004, 'This run is not tied to a team spec — its members cannot be materialized.')
  }
  const member = findSpecMember(team, params.member)
  if (!member) {
    const roster = team.members.map((m) => `"${m.title}"`).join(', ')
    throw new RpcError(
      -32602,
      `No member "${params.member}" in team "${team.name}". Members: ${roster || '(none)'}.`,
    )
  }
  const prompt = params.itemTitle
    ? `You are "${member.title}" — a member of the "${team.name}" session team. ` +
      `The user assigned "${params.itemTitle}"${params.itemId ? ` (${params.itemId})` : ''} on the project board to you — ` +
      'acknowledge FIRST with team_item_comment in the thread — before any other work — then call team_item_get for the full brief and move it to in_progress when you start. ' +
      "Narrate progress on the item thread — the board is the team's shared view of your work."
    : `You are "${member.title}" — a member of the "${team.name}" session team. ` +
      'The user just spawned your session for this run — a board item is being assigned to you; watch your inbox and the project board.'
  // Item đích (khi có) → auto-route model/effort của member theo tính chất
  // việc, đè lên override tay — cùng đường routeSession của dispatch tools.
  let routeItem
  if (params.itemId && root.projectId) {
    try {
      routeItem = (await listBoardItems(root.projectId)).find(
        (i) => i.id === params.itemId,
      )
    } catch {
      /* board đọc hỏng ⇒ member vẫn spawn theo override tay */
    }
  }
  const res = await materializeMember({
    runId: root.id,
    team,
    member,
    summaries,
    dispatchPrompt: prompt,
    ...(routeItem ? { routeItem } : {}),
    // Override LLM của người dùng: param gửi thẳng thắng (editor dispatch vừa
    // ghi assigneeConfig xong, hoặc item chưa ghi kịp); vắng ⇒ tra lại trên
    // item theo `member:<title>` — phủ đường applyStatus kéo-cột.
    ...(params.llmOverride
      ? { llmOverride: params.llmOverride }
      : root.projectId
        ? {
            llmOverride: await loadMemberLlmOverride(
              root.projectId,
              params.itemId,
              member.title,
            ),
          }
        : {}),
  })
  return { sessionId: res.sessionId, spawned: res.spawned }
})

// ─── sessions.spawnDraft ──────────────────────────────────────────────────────
// Sinh DRAFT bằng AI cho popover điều phối — nút "Tạo bằng AI" (cả ê-kíp) và các
// nút sparkle trên ô title/role/prompt của từng con. One-shot qua `completePi`
// (khuôn sessions.generateTitle): provider/model/account của PHIÊN CHA, rẻ trước
// (CHEAP_MODEL) rồi mới tới model phiên khi bản rẻ không chạy được.
//
// Kết quả chỉ là DRAFT — chúng đổ vào các ô input của popover để người dùng sửa
// tiếp, KHÔNG tự tạo phiên. Đường tạo vẫn đi qua approve → spawnMemberSessions.

const MAX_BRIEF_LEN = 4000

const SpawnDraftParams = z.object({
  sessionId: z.string().min(1).regex(SESSION_ID_RE),
  // Yêu cầu người dùng gõ trong popover. Field-mode có thể vắng (sinh từ ngữ
  // cảnh các ô đã có), nhưng team-mode thì bắt buộc — checked ở handler.
  brief: z.string().max(MAX_BRIEF_LEN).default(''),
  mode: z.enum(['team', 'field']),
  field: z.enum(['title', 'role', 'prompt']).optional(),
  // Các ô hiện có của phiên con đang chỉnh — sinh field sao cho khớp phần còn lại.
  context: z
    .object({
      title: z.string().max(MAX_TITLE_LEN).optional(),
      role: z.string().max(MAX_ROLE_LEN).optional(),
      prompt: z.string().max(MAX_TEXT_LEN).optional(),
    })
    .optional(),
})

// Model rẻ theo provider (mirror sessions.generate-title.ts); vắng mặt ⇒ dùng
// luôn model của phiên — bản rẻ không phải provider nào cũng có.
const CHEAP_MODEL: Partial<Record<ProviderName, string>> = {
  anthropic: 'claude-haiku-4-5',
}

const TEAM_SYS = `You draft a team of child sessions for an orchestration tool. Given the user's request, propose 1 to 4 specialist sub-sessions that would split the work well.
Output ONLY a JSON array — no prose, no markdown fence:
[{"title": "…", "role": "…", "prompt": "…"}]
Rules:
- title: max 80 characters, names the work (not the role). When the request centers on one specific GitHub issue/PR (a github.com/<org>/<repo>/(issues|pull)/<n> link or an explicit "#<n>" reference), title = "#<n>_IS: <short desc>" for an issue, "#<n>_PR: <short desc>" for a pull request.
- role: 1-3 words naming the function in the team (e.g. "Reviewer", "Backend dev"); "" is allowed.
- prompt: the FULL first assignment for that session — it starts with zero shared context, so state the goal, constraints and relevant file paths in full.
- Match the language of the request.`

const FIELD_SYS: Record<'title' | 'role' | 'prompt', string> = {
  title: `You write a short session title for a child session in an orchestration team. Max 80 characters, names the work (not the role), Title Case, match the language of the request. When the request centers on one specific GitHub issue/PR (a github.com/<org>/<repo>/(issues|pull)/<n> link or an explicit "#<n>" reference), the title MUST be "#<n>_IS: <short desc>" for an issue or "#<n>_PR: <short desc>" for a pull request. Output ONLY the title — no quotes, no trailing punctuation.`,
  role: `You write a very short role label for a child session in an orchestration team (e.g. "Reviewer", "Backend dev"). Max 60 characters, match the language of the request. Output ONLY the role label.`,
  prompt: `You write the first assignment handed to a child session in an orchestration team. The session starts with ZERO shared context, so state the goal, constraints and relevant file paths in full, as plain prose. Match the language of the request. Output ONLY the assignment text.`,
}

// Cắt mảng JSON ra khỏi output của model (chịu được prose thừa quanh mảng), rồi
// sanitize từng spec bằng đúng đường `oneLineLabel` mà spawn.ts áp cho tiêu đề/vai.
function parseTeamDraft(raw: string): SpawnChildSpec[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let arr: unknown
  try {
    arr = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const out: SpawnChildSpec[] = []
  for (const item of arr.slice(0, MAX_SPAWNS_PER_TURN)) {
    const it = item as Record<string, unknown>
    const title = oneLineLabel(String(it?.title ?? ''), MAX_TITLE_LEN)
    const role = oneLineLabel(String(it?.role ?? ''), MAX_ROLE_LEN)
    const prompt = String(it?.prompt ?? '').trim().slice(0, MAX_TEXT_LEN)
    if (title && prompt) out.push({ title, role, prompt })
  }
  return out
}

// Một completion thử lần lượt model rẻ → model phiên (y hệt generateTitle).
async function draftWithFallback(input: {
  provider: ProviderName
  sessionModel: string
  accountId?: string
  systemPrompt: string
  prompt: string
}): Promise<string> {
  const cheap = CHEAP_MODEL[input.provider]
  const candidates =
    cheap && cheap !== input.sessionModel ? [cheap, input.sessionModel] : [input.sessionModel]
  for (const modelId of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop -- intentional sequential fallback
      const out = await completePi({
        provider: input.provider,
        ...(input.accountId ? { accountId: input.accountId } : {}),
        modelId,
        systemPrompt: input.systemPrompt,
        prompt: input.prompt,
      })
      if (out.trim()) return out
    } catch (err) {
      log.warn('sessions.spawnDraft attempt failed', {
        model: modelId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return ''
}

register('sessions.spawnDraft', async (raw) => {
  const params = SpawnDraftParams.parse(raw)
  const session = await loadSession(params.sessionId)
  if (!session) throw new RpcError(-32004, 'Session not found')

  const brief = params.brief.trim()
  const ctx = params.context
  const body = [
    brief ? `Request: ${brief}` : '',
    ctx?.title ? `Title so far: ${ctx.title}` : '',
    ctx?.role ? `Role so far: ${ctx.role}` : '',
    ctx?.prompt ? `Assignment so far: ${ctx.prompt.slice(0, 2000)}` : '',
    '',
    params.mode === 'team' ? 'Draft the team now.' : 'Write it now.',
  ]
    .filter(Boolean)
    .join('\n')

  const base = {
    provider: session.settings.provider,
    sessionModel: session.settings.modelId,
    ...(session.settings.accountId ? { accountId: session.settings.accountId } : {}),
  }

  if (params.mode === 'team') {
    if (!brief) throw new RpcError(-32602, 'brief is required in team mode')
    const out = await draftWithFallback({ ...base, systemPrompt: TEAM_SYS, prompt: body })
    return { children: parseTeamDraft(out) }
  }

  const field = params.field
  if (!field) throw new RpcError(-32602, 'field is required in field mode')
  if (!brief && !ctx?.title && !ctx?.role && !ctx?.prompt) {
    throw new RpcError(-32602, 'field mode needs a brief or some context to generate from')
  }
  const out = await draftWithFallback({
    ...base,
    systemPrompt: FIELD_SYS[field],
    prompt: body,
  })
  const value =
    field === 'prompt'
      ? out.trim().slice(0, MAX_TEXT_LEN)
      : oneLineLabel(out, field === 'title' ? MAX_TITLE_LEN : MAX_ROLE_LEN)
  return { value }
})
