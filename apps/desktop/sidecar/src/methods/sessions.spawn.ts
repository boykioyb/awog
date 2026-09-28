// RPC của popover ĐIỀU PHỐI phiên (sessions/spawn-approval.ts):
//
//   sessions.spawnResolve   — trả lời một `session.spawn-request` đang park:
//                             duyệt (kèm danh sách/cấu hình đã sửa) hay từ chối.
//   sessions.setGroupSpawn  — ghi nhớ / xoá cấu hình spawn trên gốc nhóm
//                             ("nhớ cho cả nhóm" ⇄ "ngừng điều phối").
//   sessions.spawnChildren  — đường THỦ CÔNG: menu ⋯ của một phiên mở cùng một
//                             popover, không qua tool `create_session` của model.
//
// Một lần DUYỆT đồng nghĩa hai ghi trên phiên GỐC của nhóm:
//   1. `groupAutoDeliver: true`  — workflow được duyệt thì phải TỰ CHẠY, nếu
//      không phiên con lại rơi về chip "Give to agent" mà tính năng này sinh ra
//      để xoá. Trần 40 tin/30 phút của auto-deliver vẫn áp ở renderer.
//   2. `groupSpawnConfig` khi `remember` — lần `create_session` sau của nhóm này
//      bỏ qua popover, đẻ thẳng theo cấu hình đã nhớ (xem spawn.ts/groupRootOf).
//
// Cả hai đều được ghi TRƯỚC khi request héo: runner spawn → `session.created` →
// `session.inbox-message` tới renderer SAU khi cờ đã nằm trên đĩa + trong store,
// nên không có cửa sổ nào tin tới trước khi nhóm được phép tự giao.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import {
  peekArmRequest,
  peekSpawnRequest,
  resolveArmRequest,
  resolveSpawnRequest,
} from '../sessions/spawn-approval.js'
import {
  MAX_CHILDREN,
  MAX_ROLE_LEN,
  MAX_SPAWNS_PER_TURN,
  MAX_TITLE_LEN,
  SpawnError,
  armGroupAutoDeliver,
  groupRootOf,
  spawnChildrenSessions,
} from '../sessions/spawn.js'
import { MAX_TEXT_LEN, oneLineLabel } from '../sessions/inbox.js'
import {
  flushSession,
  listSessionSummaries,
  loadSession,
  setSessionGroupSpawn,
  updateSessionMetadata,
} from '../sessions/store.js'
import { emit } from '../transport/stdio.js'
import { completePi } from '../runtime/complete.js'
import { log } from '../util/logger.js'
import type { ProviderName, SpawnChildSpec, SpawnSessionConfig } from '../types/shared.js'

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
})

// exactOptionalPropertyTypes: dựng lại object chỉ với key thật sự có mặt —
// object rỗng hoàn toàn trả undefined: caller phải phân biệt "không gửi config"
// với "config rỗng". Riêng đường remember, `armGroupWorkflow` cố ý đổi rỗng →
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
// được vào `config?: T` (exactOptionalPropertyTypes) — key phải VẮNG hẳn.
function toChildSpecs(
  parsed: z.infer<typeof ChildSpecSchema>[],
): SpawnChildSpec[] {
  return parsed.map((c) => {
    const { config, ...rest } = c
    const cfg = toSpawnConfig(config)
    return cfg ? { ...rest, config: cfg } : rest
  })
}

// Bật "workflow tự chạy" cho nhóm của `rootId`: tự giao tin + (tuỳ chọn) nhớ
// cấu hình spawn. Gọi TRƯỚC khi resolve/spawn — xem khối comment đầu file.
// `remember` mà config rỗng (mọi field kế thừa) vẫn ghi `{}` — marker "đã duyệt
// rồi đừng hỏi nữa": groupRootOf chỉ bỏ qua popover khi `groupSpawnConfig` tồn
// tại, và config thiếu hẳn sẽ làm lời hứa "allow 1 lần" thất hứa lần sau.
// `setGroupSpawn` của session-manager coi `{}` là ghi, chỉ `null` mới là xoá.
async function armGroupWorkflow(rootId: string, remember: boolean, config?: SpawnSessionConfig): Promise<void> {
  const saved = remember ? (config ?? {}) : undefined
  if (saved) await setSessionGroupSpawn(rootId, saved)
  // Emit SAU khi config đã nằm trên đĩa để payload group-armed mang theo nó —
  // renderer khác (kể cả popout) nhận đủ trạng thái một lần, không phải chờ
  // reload mới thấy nhóm đã "nhớ".
  await armGroupAutoDeliver(rootId, saved)
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
    await armGroupWorkflow(parked.rootId, params.remember === true, config)
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

// ─── sessions.armResolve ─────────────────────────────────────────────────────
// Trả lời một `session.arm-request` đang park (tool `arm_group` của model —
// spawn-approval.ts). Chỉ mang một quyết định duyệt/không kèm lời từ chối tự
// do; không có children/config như spawnResolve vì request chỉ xin BẬT cờ
// `groupAutoDeliver` trên gốc nhóm.
// Duyệt ⇒ ghi cờ TRƯỚC khi request héo — cùng luật thứ tự với cổng spawn:
// `session.group-armed` tới renderer → flush tin park trong nhóm, rồi tool mới
// tiếp tục và trả kết quả "đã bật" cho model.

const ArmResolveParams = z.object({
  requestId: z.string().regex(/^arm-[a-f0-9]+$/),
  approved: z.boolean(),
  message: z.string().max(500).optional(),
})

register('sessions.armResolve', async (raw) => {
  const params = ArmResolveParams.parse(raw)
  const parked = peekArmRequest(params.requestId)
  if (!parked) return { resolved: false }
  if (params.approved) {
    await armGroupAutoDeliver(parked.rootId)
    resolveArmRequest(params.requestId, { approved: true })
  } else {
    resolveArmRequest(params.requestId, {
      approved: false,
      ...(params.message ? { message: params.message } : {}),
    })
  }
  return { resolved: true }
})

// ─── sessions.setGroupSpawn ───────────────────────────────────────────────────
// Ghi nhớ/xoá cấu hình spawn trên phiên GỐC. `config: null` = "ngừng điều phối"
// (xoá hẳn key — vì vậy phải là RPC riêng, patch spread không xoá được key).

const SetGroupSpawnParams = z.object({
  id: z.string().min(1).regex(SESSION_ID_RE),
  config: SpawnConfigSchema.nullable(),
})

register('sessions.setGroupSpawn', async (raw) => {
  const params = SetGroupSpawnParams.parse(raw)
  // Config sống trên GỐC nhóm — caller gửi id của một phiên CON thì phải leo lên
  // gốc, nếu không key được ghi nơi groupRootOf không bao giờ tra.
  const root = groupRootOf(await listSessionSummaries(), params.id)
  if (!root) throw new RpcError(-32004, 'Session not found')
  const ok = await setSessionGroupSpawn(root.id, toSpawnConfig(params.config ?? undefined) ?? null)
  if (!ok) throw new RpcError(-32004, 'Session not found')
  return { ok: true }
})

// ─── sessions.setGroupAutoDeliver ────────────────────────────────────────────
// Công tắc tự-giao của nhóm — viết TRÊN GỐC, giống setGroupSpawn. Đường ghi duy
// nhất sau khi tạo phiên: field này CỐ Ý không đi `sessions.upsert` nữa — patch
// spread của update-metadata không phân biệt được "cờ tắt có chủ đích" với "cờ
// true cũ của một cửa sổ chưa nghe disarm" (persistence-queue lấy theo đĩa khi
// local vắng mặt, nên để upsert mang nó sẽ hồi sinh cờ sau toggle-off). RPC riêng
// emit `session.group-armed` kèm giá trị mới để MỌI cửa sổ/popout hội tụ — kể
// cả chiều tắt.

const SetGroupAutoDeliverParams = z.object({
  id: z.string().min(1).regex(SESSION_ID_RE),
  value: z.boolean(),
})

register('sessions.setGroupAutoDeliver', async (raw) => {
  const params = SetGroupAutoDeliverParams.parse(raw)
  const root = groupRootOf(await listSessionSummaries(), params.id)
  if (!root) throw new RpcError(-32004, 'Session not found')
  await updateSessionMetadata(root.id, { groupAutoDeliver: params.value })
  // Flush ngay như các ghi rời rạc khác (setGroup/setGroupSpawn): thoát app trong
  // cửa sổ debounce 500ms mà mất cờ này thì nhóm vừa arm lại hỏi popover, hoặc
  // nhóm vừa disarm lại tự chạy sau reload.
  await flushSession(root.id)
  emit('session.group-armed', {
    sessionId: root.id,
    groupAutoDeliver: params.value,
  })
  return { ok: true }
})

// ─── sessions.spawnChildren ───────────────────────────────────────────────────
// Đường thủ công từ menu ⋯ của một phiên: người dùng TỰ đề xuất ê-kíp trong
// popover thay vì model gọi `create_session`. Đã đi qua popover = đã được duyệt,
// nên nhóm được arm (auto-deliver + remember tuỳ chọn) rồi đẻ ngay.

const SpawnChildrenParams = z.object({
  sessionId: z.string().min(1).regex(SESSION_ID_RE),
  children: z.array(ChildSpecSchema).min(1).max(MAX_CHILDREN),
  // Cấu hình CHUNG của lô — đã được renderer trộn vào từng `children[].config`
  // nếu có đè riêng; ở đây nó chỉ còn một việc: thứ ghi nhớ khi `remember`.
  config: SpawnConfigSchema.optional(),
  remember: z.boolean().optional(),
})

register('sessions.spawnChildren', async (raw) => {
  const params = SpawnChildrenParams.parse(raw)
  const root = groupRootOf(await listSessionSummaries(), params.sessionId)
  if (!root) throw new RpcError(-32004, 'Session not found')
  const config = toSpawnConfig(params.config)
  await armGroupWorkflow(root.id, params.remember === true, config)
  // KHÔNG throw khi lô hỏng: arm đã ghi đĩa trước đó, throw sẽ làm renderer
  // rollback cờ local trong khi disk vẫn armed — hai bên lệch nhau tới khi
  // reload. SpawnError (cha mất, chạm trần con) cũng xếp vào `failed` để UI báo
  // theo từng con bằng toast sẵn có.
  try {
    return await spawnChildrenSessions(params.sessionId, toChildSpecs(params.children))
  } catch (err) {
    // Dù lỗi gì thì arm ĐÃ ghi đĩa — rethrow làm renderer rollback cờ local
    // trong khi disk vẫn armed (hai bên lệch nhau tới reload). Trả `failed` để
    // UI báo bằng toast; lỗi lạ (không phải SpawnError) vẫn được log lại.
    if (!(err instanceof SpawnError)) {
      log.warn('spawnChildren failed unexpectedly', { err: String(err) })
    }
    return {
      created: [],
      failed: [{ title: '(spawn)', reason: err instanceof Error ? err.message : String(err) }],
    }
  }
})

// ─── sessions.spawnDraft ──────────────────────────────────────────────────────
// Sinh DRAFT bằng AI cho popover điều phối — nút "Tạo bằng AI" (cả ê-kíp) và các
// nút sparkle trên ô title/role/prompt của từng con. One-shot qua `completePi`
// (khuôn sessions.generateTitle): provider/model/account của PHIÊN CHA, rẻ trước
// (CHEAP_MODEL) rồi mới tới model phiên khi bản rẻ không chạy được.
//
// Kết quả chỉ là DRAFT — chúng đổ vào các ô input của popover để người dùng sửa
// tiếp, KHÔNG tự tạo phiên. Đường tạo vẫn đi qua approve → spawnChildrenSessions.

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
- title: max 80 characters, names the work (not the role).
- role: 1-3 words naming the function in the team (e.g. "Reviewer", "Backend dev"); "" is allowed.
- prompt: the FULL first assignment for that session — it starts with zero shared context, so state the goal, constraints and relevant file paths in full.
- Match the language of the request.`

const FIELD_SYS: Record<'title' | 'role' | 'prompt', string> = {
  title: `You write a short session title for a child session in an orchestration team. Max 80 characters, names the work (not the role), Title Case, match the language of the request. Output ONLY the title — no quotes, no trailing punctuation.`,
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
