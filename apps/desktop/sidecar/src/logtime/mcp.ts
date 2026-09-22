// Cầu nối Logtime ↔ PMS (ADR 0091 D-1/D-2). Tất cả đi qua MCP của chính nguồn đó:
// không adapter riêng cho từng PMS, không token nằm ngoài keychain.
//
// Năng lực dò bằng `tools/list` rồi ánh xạ sang quy ước tên `worklog_*`. Nguồn nào
// thiếu tool bắt buộc thì Logtime để chế độ chỉ đọc và nói ra thiếu gì — thêm một
// PMS mới không tốn dòng code nào nếu nó theo quy ước.

import { loadSourceById, listSources } from '../sources/store.js'
import { resolveSourceMcpConfig } from '../sources/mcp-config.js'
import { testSource } from '../sources/test.js'
import { callMcpToolText } from '../runtime/tools/mcp-tools.js'
import { RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import type { LogtimeSourceCapability } from '../types/shared.js'
import type { McpSource, SourceConfig } from '../types/shared.js'

// Quy ước tên tool. `REQUIRED` là tối thiểu để ĐẨY được; còn lại là tuỳ chọn và
// chỉ làm mất tính năng tương ứng ở UI chứ không chặn.
export const TOOL = {
  listProjects: 'worklog_list_projects',
  listTasks: 'worklog_list_tasks',
  list: 'worklog_list',
  get: 'worklog_get',
  create: 'worklog_create',
  update: 'worklog_update',
  remove: 'worklog_delete',
} as const

const REQUIRED: readonly string[] = [TOOL.listProjects, TOOL.create]

function isMcpSource(s: SourceConfig): s is McpSource {
  return s.type === 'mcp'
}

async function resolveMcp(sourceId: string): Promise<{ source: McpSource; cfg: NonNullable<Awaited<ReturnType<typeof resolveSourceMcpConfig>>> }> {
  // `sourceId` is the source's stable `id` — the same value the UI sends and
  // `probeSources` matches on — NOT the folder slug. Using `loadSource` here
  // looked the id up as a folder name and failed for every call.
  const source = await loadSourceById(sourceId)
  if (!source) throw new RpcError(-32602, `source not found: ${sourceId}`)
  if (!isMcpSource(source)) throw new RpcError(-32602, `source is not an MCP source: ${sourceId}`)
  if (!source.enabled) throw new RpcError(-32602, `source is disabled: ${sourceId}`)
  const cfg = await resolveSourceMcpConfig(source)
  if (!cfg) throw new RpcError(-32602, `source has no usable transport: ${sourceId}`)
  return { source, cfg }
}

// MCP server gói JSON trong content text. Trả `null` khi không parse được thay vì
// throw: một vài tool trả chuỗi thường (thông báo lỗi) và caller muốn đọc nguyên văn.
function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export async function callWorklogTool<T>(
  sourceId: string,
  tool: string,
  params: unknown,
): Promise<{ data: T | null; text: string; isError: boolean }> {
  const { source, cfg } = await resolveMcp(sourceId)
  const { text, isError } = await callMcpToolText(source.id, cfg, tool, params)
  return { data: parseJson<T>(text), text, isError }
}

// Dò năng lực của MỘT nguồn. Không bao giờ throw vì lỗi kết nối — nguồn không tới
// được vẫn phải hiện ra trong danh sách kèm lý do, thay vì làm hỏng cả màn hình.
export async function probeSource(source: SourceConfig): Promise<LogtimeSourceCapability> {
  const base: LogtimeSourceCapability = {
    sourceId: source.id,
    name: source.name,
    ...(isMcpSource(source) && source.mcp.url ? { url: source.mcp.url } : {}),
    tools: [],
    missing: [...REQUIRED],
    canPush: false,
    canListTasks: false,
    canPull: false,
  }
  if (!isMcpSource(source)) return { ...base, error: 'not an MCP source' }
  try {
    const outcome = await testSource(source)
    const tools = (outcome.tools ?? []).map((t) => t.name)
    const missing = REQUIRED.filter((r) => !tools.includes(r))
    return {
      ...base,
      tools,
      missing,
      canPush: missing.length === 0,
      canListTasks: tools.includes(TOOL.listTasks),
      canPull: tools.includes(TOOL.list),
      ...(outcome.error ? { error: outcome.error } : {}),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn('[logtime] probe failed', { sourceId: source.id, err: message })
    return { ...base, error: message }
  }
}

// Dò tất cả nguồn `mcp` đang bật. Chạy tuần tự: mỗi probe là một handshake thật,
// bắn song song vào N server chỉ để vẽ một bảng là không đáng.
/** Nguồn MCP đang bật — chỉ để UI gợi ý lúc người dùng CHỌN thêm nguồn. */
export async function enabledMcpSources(): Promise<
  { id: string; name: string; url?: string | undefined }[]
> {
  const sources = await listSources()
  return sources
    .filter((s) => s.enabled && s.type === 'mcp')
    .map((s) => ({
      id: s.id,
      name: s.name,
      ...(s.type === 'mcp' && s.mcp.url ? { url: s.mcp.url } : {}),
    }))
}

// Dò năng lực của ĐÚNG những nguồn người dùng đã chọn ở tab Thiết lập (ADR 0091 D-2).
// Không dò hết mọi server MCP đang bật: mỗi lần dò là một handshake thật chạy tuần
// tự, và người dùng có GitHub/Playwright/... cài sẵn sẽ nhận một bảng đầy dấu ✗ cho
// những server chẳng liên quan gì tới chấm công.
//
// Nguồn đã chọn mà KHÔNG còn tồn tại (bị xoá/tắt ở trang Sources) vẫn trả về một
// dòng kèm lý do, để UI nói được "nguồn này đã mất" thay vì im lặng bỏ qua.
export async function probeSources(sourceIds: string[]): Promise<LogtimeSourceCapability[]> {
  const all = await listSources()
  const out: LogtimeSourceCapability[] = []
  for (const id of sourceIds) {
    const source = all.find((s) => s.id === id)
    if (!source) {
      out.push({
        sourceId: id,
        name: id,
        tools: [],
        missing: [...REQUIRED],
        canPush: false,
        canListTasks: false,
        canPull: false,
        error: 'source not found',
      })
      continue
    }
    if (!source.enabled || source.type !== 'mcp') {
      out.push({
        sourceId: id,
        name: source.name,
        tools: [],
        missing: [...REQUIRED],
        canPush: false,
        canListTasks: false,
        canPull: false,
        error: source.enabled ? 'not an MCP source' : 'source is disabled',
      })
      continue
    }
    // eslint-disable-next-line no-await-in-loop
    out.push(await probeSource(source))
  }
  return out
}

// ── Các lời gọi worklog ──────────────────────────────────────────────────────

export interface PmsOption {
  label: string
  value: string
}

// Chuẩn hoá kết quả `worklog_list_projects` / `worklog_list_tasks` về {label,value}.
// PMS mỗi hệ trả một shape khác nhau — có hệ `{label,value}`, có hệ `{id,title}` /
// `{taskId,name}` — nên nhận SIÊU TẬP các khoá thường gặp thay vì đòi đúng
// `{label,value}` (đòi cứng thì task list im lặng rỗng dù PMS trả về đủ). L1 ⇒ chuẩn
// hoá ở biên là đúng chỗ.
function pickStr(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.length > 0) return v
    // id số vẫn là định danh hợp lệ — ép về chuỗi.
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return undefined
}

function asOptions(data: unknown): PmsOption[] {
  // Một số hệ bọc mảng trong `{ tasks: [...] }` / `{ items: [...] }` / `{ rows: [...] }`.
  let arr: unknown = data
  if (!Array.isArray(arr) && arr && typeof arr === 'object') {
    for (const v of Object.values(arr as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        arr = v
        break
      }
    }
  }
  if (!Array.isArray(arr)) return []
  const out: PmsOption[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const value = pickStr(o, ['value', 'id', 'taskId', 'key', 'code'])
    if (!value) continue
    const label = pickStr(o, ['label', 'title', 'name', 'subject', 'summary']) ?? value
    out.push({ label, value })
  }
  return out
}

export async function listPmsProjects(sourceId: string, q?: string): Promise<PmsOption[]> {
  const res = await callWorklogTool<unknown>(sourceId, TOOL.listProjects, q ? { q } : {})
  if (res.isError) throw new RpcError(-32603, res.text.slice(0, 400))
  return asOptions(res.data)
}

export async function listPmsTasks(
  sourceId: string,
  projectId: string,
  q?: string,
): Promise<PmsOption[]> {
  const res = await callWorklogTool<unknown>(sourceId, TOOL.listTasks, {
    projectId,
    ...(q ? { q } : {}),
  })
  if (res.isError) throw new RpcError(-32603, res.text.slice(0, 400))
  return asOptions(res.data)
}

export interface CreateWorklogInput {
  projectId: string
  date: string
  hours: number
  note?: string
  taskIds?: string[]
  githubIssueUrls?: string[]
}

// `worklog_create` đòi ít nhất một trong taskIds / githubIssueUrls / note — kiểm ở
// đây để lỗi hiện ra trước khi bay qua mạng.
export async function createWorklog(
  sourceId: string,
  input: CreateWorklogInput,
): Promise<{ id: string }> {
  const hasAnchor =
    (input.note && input.note.trim().length > 0) ||
    (input.taskIds && input.taskIds.length > 0) ||
    (input.githubIssueUrls && input.githubIssueUrls.length > 0)
  if (!hasAnchor) {
    throw new RpcError(-32602, 'worklog_create needs one of note / taskIds / githubIssueUrls')
  }
  const res = await callWorklogTool<{ id?: string }>(sourceId, TOOL.create, {
    projectId: input.projectId,
    date: input.date,
    hours: input.hours,
    ...(input.note ? { note: input.note } : {}),
    ...(input.taskIds && input.taskIds.length > 0 ? { taskIds: input.taskIds } : {}),
    ...(input.githubIssueUrls && input.githubIssueUrls.length > 0
      ? { githubIssueUrls: input.githubIssueUrls }
      : {}),
  })
  if (res.isError) throw new Error(res.text.slice(0, 400))
  const id = res.data?.id
  if (!id) throw new Error(`worklog_create returned no id: ${res.text.slice(0, 200)}`)
  return { id }
}

export interface PmsWorklogRow {
  id: string
  projectId: string
  date: string
  hours: number
  note: string
  lockedAt: string | null
  tasks: { id?: string; issue?: number; title?: string }[]
}

interface RawRow {
  id?: unknown
  projectId?: unknown
  date?: unknown
  hours?: unknown
  note?: unknown
  lockedAt?: unknown
  tasks?: unknown
}

// PMS trả `hours` dạng CHUỖI ("3") trong khi nhận vào là số — parse lại ở biên.
function asRow(raw: RawRow): PmsWorklogRow | null {
  if (typeof raw.id !== 'string' || typeof raw.projectId !== 'string') return null
  const hours = Number(raw.hours)
  const date = typeof raw.date === 'string' ? raw.date.slice(0, 10) : ''
  if (!Number.isFinite(hours) || !date) return null
  const tasks: PmsWorklogRow['tasks'] = []
  if (Array.isArray(raw.tasks)) {
    for (const wrapper of raw.tasks) {
      const t = (wrapper as { task?: Record<string, unknown> })?.task
      if (!t) continue
      tasks.push({
        ...(typeof t.id === 'string' ? { id: t.id } : {}),
        ...(typeof t.githubIssueId === 'number' ? { issue: t.githubIssueId } : {}),
        ...(typeof t.title === 'string' ? { title: t.title } : {}),
      })
    }
  }
  return {
    id: raw.id,
    projectId: raw.projectId,
    date,
    hours,
    note: typeof raw.note === 'string' ? raw.note : '',
    lockedAt: typeof raw.lockedAt === 'string' ? raw.lockedAt : null,
    tasks,
  }
}

export async function listWorklogs(
  sourceId: string,
  from: string,
  to: string,
): Promise<PmsWorklogRow[]> {
  const res = await callWorklogTool<{ rows?: RawRow[] }>(sourceId, TOOL.list, {
    from,
    to,
    pageSize: 100,
  })
  if (res.isError) throw new RpcError(-32603, res.text.slice(0, 400))
  const rows = Array.isArray(res.data?.rows) ? res.data.rows : []
  const out: PmsWorklogRow[] = []
  for (const raw of rows) {
    const row = asRow(raw)
    if (row) out.push(row)
  }
  return out
}
