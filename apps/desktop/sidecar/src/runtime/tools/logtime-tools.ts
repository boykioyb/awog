// Logtime tools cho agent (ADR 0091). Một phiên chat trả lời được "hôm nay tôi
// khai mấy tiếng rồi?" và ghi hộ một dòng công, thay vì người dùng phải rời chat
// sang trang /logtime.
//
// Bốn ràng buộc của bộ tool này, mỗi cái là một quyết định chứ không phải thiếu sót:
//
//  1. KHÔNG có tool đẩy lên PMS. ADR 0091 D-5: ghi lên hệ thống công ty luôn cần
//     người bấm. Agent soạn nháp; nút Đẩy vẫn ở trang Logtime.
//  2. Thêm dòng đi qua `addEntryGated` — CÙNG cổng trần giờ mà UI dùng, nên một
//     phiên chat không khai nổi 20h/ngày dù model có cố.
//  3. Chỉ xoá được dòng NHÁP. Dòng đã đẩy còn sống trên PMS; xoá ở AWOG chỉ làm
//     hai bên lệch nhau.
//  4. Dự án nhận theo TÊN người dùng đang thấy (khớp mềm), vì model không có lý do
//     gì biết `projectKey` nội bộ — nhưng vẫn phải là dự án ĐÃ NỐI, không tự tạo.

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import {
  addEntryGated,
  loadMonth,
  loadSettings,
  monthOf,
  removeDraft,
} from '../../logtime/store.js'
import type { LogtimeEntry, LogtimeLink } from '../../types/shared.js'

// Tool GHI — permission gate phải thấy đúng danh sách này (cùng lý do như
// WIKI_MUTATING_TOOL_NAMES: hai danh sách lệch nhau là một lỗ quyền).
export const LOGTIME_MUTATING_TOOL_NAMES = ['logtime_add', 'logtime_remove'] as const

// Tên server MCP in-process trên nhánh Claude SDK + danh sách tool, để bảng bắc
// cầu (tools/bridged.ts) DẪN XUẤT thay vì chép tay — thêm tool ở đây là gấp/nở tên
// tự đúng ở cả cổng quyền lẫn nhãn transcript.
export const LOGTIME_MCP_SERVER = 'awoglogtime'
export const LOGTIME_TOOL_NAMES = [
  'logtime_day',
  'logtime_projects',
  ...LOGTIME_MUTATING_TOOL_NAMES,
] as const

const fmt = (n: number): string => n.toFixed(2).replace(/\.?0+$/, '')

function todayIso(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function resolveDate(raw: string | undefined): string {
  if (!raw) return todayIso()
  if (!DATE_RE.test(raw)) throw new Error(`date must be YYYY-MM-DD, got "${raw}"`)
  return raw
}

// Khớp mềm tên dự án: đúng khoá → đúng tên → chứa chuỗi. Không tìm thấy thì liệt
// kê những tên hợp lệ, vì "project not found" trần trụi khiến model đoán tiếp.
function resolveLink(links: LogtimeLink[], wanted: string): LogtimeLink {
  const needle = wanted.trim().toLowerCase()
  const nameOf = (l: LogtimeLink): string => (l.pmsProjectName || l.label || l.projectKey)
  const exactKey = links.find((l) => l.projectKey.toLowerCase() === needle)
  if (exactKey) return exactKey
  const exactName = links.find((l) => nameOf(l).toLowerCase() === needle)
  if (exactName) return exactName
  const partial = links.filter(
    (l) => nameOf(l).toLowerCase().includes(needle) || l.projectKey.toLowerCase().includes(needle),
  )
  if (partial.length === 1 && partial[0]) return partial[0]
  const known = links.map(nameOf).join(' · ') || '(chưa nối dự án nào)'
  if (partial.length > 1) {
    throw new Error(`"${wanted}" khớp nhiều dự án: ${partial.map(nameOf).join(' · ')}`)
  }
  throw new Error(`Không có dự án nào tên "${wanted}". Dự án đã nối: ${known}`)
}

function lineOf(entry: LogtimeEntry, link: LogtimeLink | undefined): string {
  const name = link ? link.pmsProjectName || link.label || link.projectKey : entry.projectKey
  const task = entry.task?.issue ? ` (#${entry.task.issue})` : ''
  const state =
    entry.status === 'draft' ? 'nháp' : entry.status === 'posted' ? 'đã đẩy' : 'đã khoá'
  return `- ${name} · ${fmt(entry.hours)}h · ${entry.note}${task} [${state}] id=${entry.id}`
}

// ── Handler dùng chung cho cả hai runtime ────────────────────────────────────

export async function runLogtimeDay(rawDate: string | undefined): Promise<{ text: string }> {
  const date = resolveDate(rawDate)
  const [settings, doc] = await Promise.all([loadSettings(), loadMonth(monthOf(date))])
  const entries = doc.days[date]?.entries ?? []
  const total = entries.reduce((s, e) => s + e.hours, 0)
  const budget = settings.dailyHours
  const drafts = entries.filter((e) => e.status === 'draft').length
  const head =
    `${date}: ${fmt(total)}h / ${fmt(budget)}h` +
    (total < budget ? ` (thiếu ${fmt(budget - total)}h)` : total > budget ? ' (VƯỢT mức)' : ' (đủ)')
  if (entries.length === 0) {
    return { text: `${head}\nChưa có dòng công nào cho ngày này.` }
  }
  const lines = entries.map((e) => lineOf(e, settings.links.find((l) => l.projectKey === e.projectKey)))
  const tail = drafts > 0 ? `\n${drafts} dòng còn là nháp — người dùng phải tự bấm Đẩy ở trang Logtime.` : ''
  return { text: `${head}\n${lines.join('\n')}${tail}` }
}

export async function runLogtimeProjects(): Promise<{ text: string }> {
  const settings = await loadSettings()
  if (settings.links.length === 0) {
    return {
      text: 'Chưa nối dự án nào với PMS. Người dùng nối ở trang Logtime → Thiết lập → Nối dự án.',
    }
  }
  const lines = settings.links.map((l) => {
    const name = l.pmsProjectName || l.label || l.projectKey
    const ready = l.pmsProjectId ? 'sẵn sàng' : 'CHƯA nối dự án PMS'
    return `- ${name} (key=${l.projectKey}) → ${l.sourceId} [${ready}]`
  })
  return { text: `Mức ${fmt(settings.dailyHours)}h/ngày, làm tròn lên ${fmt(settings.roundStep)}h.\n${lines.join('\n')}` }
}

export async function runLogtimeAdd(args: {
  project: string
  note: string
  hours: number
  date?: string | undefined
  issue?: number | undefined
}): Promise<{ text: string; isError: boolean }> {
  const date = resolveDate(args.date)
  const settings = await loadSettings()
  const link = resolveLink(settings.links, args.project)
  const name = link.pmsProjectName || link.label || link.projectKey
  const outcome = await addEntryGated(
    date,
    {
      projectKey: link.projectKey,
      note: args.note,
      hours: args.hours,
      ...(args.issue ? { task: { issue: args.issue } } : {}),
    },
    'agent',
  )
  if (outcome.reason === 'duplicate') {
    return { text: `Ngày ${date} đã có đúng dòng này ở ${name} — không thêm trùng.`, isError: true }
  }
  if (outcome.reason === 'full') {
    return {
      text: `Ngày ${date} đã đủ ${fmt(outcome.budget)}h. Xoá bớt một dòng trước khi thêm.`,
      isError: true,
    }
  }
  const cut = outcome.cut
    ? ` (đã cắt từ ${fmt(args.hours)}h xuống ${fmt(outcome.added)}h cho vừa mức ngày)`
    : ''
  return {
    text:
      `Đã thêm nháp: ${name} · ${fmt(outcome.added)}h · ${args.note}${cut}. ` +
      `Ngày ${date} giờ là ${fmt(outcome.total)}h/${fmt(outcome.budget)}h. ` +
      'Dòng này CHƯA lên PMS — người dùng bấm Đẩy ở trang Logtime mới ghi.',
    isError: false,
  }
}

export async function runLogtimeRemove(args: {
  entryId: string
  date?: string | undefined
}): Promise<{ text: string; isError: boolean }> {
  const date = resolveDate(args.date)
  const res = await removeDraft(date, args.entryId, 'agent')
  if (!res.removed) {
    return { text: `Không xoá được dòng ${args.entryId}: ${res.reason}.`, isError: true }
  }
  return { text: `Đã xoá dòng nháp ${args.entryId} khỏi ngày ${date}.`, isError: false }
}

// ── Pi AgentTools ────────────────────────────────────────────────────────────

const DayParams = Type.Object({
  date: Type.Optional(Type.String({ description: 'YYYY-MM-DD. Bỏ trống = hôm nay.' })),
})

const AddParams = Type.Object({
  project: Type.String({ description: 'Tên dự án như người dùng thấy, hoặc projectKey.' }),
  note: Type.String({ description: 'Một câu mô tả việc đã làm — đúng chữ sẽ hiện trên PMS.' }),
  hours: Type.Number({ description: 'Số giờ, 0.25–24.' }),
  date: Type.Optional(Type.String({ description: 'YYYY-MM-DD. Bỏ trống = hôm nay.' })),
  issue: Type.Optional(Type.Number({ description: 'Số issue GitHub để tự gắn task.' })),
})

const RemoveParams = Type.Object({
  entryId: Type.String({ description: 'id của dòng (lấy từ logtime_day).' }),
  date: Type.Optional(Type.String({ description: 'YYYY-MM-DD. Bỏ trống = hôm nay.' })),
})

const NoParams = Type.Object({})

export interface CreateLogtimeToolsOptions {
  // Agent được THÊM/XOÁ dòng nháp. Tắt = chỉ đọc (mặc định của Tasks).
  canWrite?: boolean | undefined
}

export function createLogtimeTools(opts: CreateLogtimeToolsOptions): AgentTool[] {
  const dayTool: AgentTool<typeof DayParams, { date: string }> = {
    name: 'logtime_day',
    label: 'Logtime day',
    description:
      'Xem giờ công của một ngày: tổng đã khai / mức ngày, và từng dòng kèm trạng thái ' +
      '(nháp | đã đẩy | đã khoá). Dùng khi người dùng hỏi hôm nay khai mấy tiếng, còn thiếu bao nhiêu.',
    parameters: DayParams,
    async execute(_id, params): Promise<AgentToolResult<{ date: string }>> {
      const { text } = await runLogtimeDay(params.date)
      return { content: [{ type: 'text', text }], details: { date: params.date ?? todayIso() } }
    },
  }

  const projectsTool: AgentTool<typeof NoParams, { count: number }> = {
    name: 'logtime_projects',
    label: 'Logtime projects',
    description:
      'Liệt kê các dự án đã nối với PMS (tên dùng được cho logtime_add) kèm mức giờ/ngày và bậc làm tròn.',
    parameters: NoParams,
    async execute(): Promise<AgentToolResult<{ count: number }>> {
      const { text } = await runLogtimeProjects()
      return { content: [{ type: 'text', text }], details: { count: 0 } }
    },
  }

  if (opts.canWrite !== true) return [dayTool, projectsTool] as AgentTool[]

  const addTool: AgentTool<typeof AddParams, { added: boolean }> = {
    name: 'logtime_add',
    label: 'Logtime add',
    description:
      'Thêm một dòng công NHÁP vào một ngày. Dòng chỉ nằm trong AWOG: việc đẩy lên PMS do người ' +
      'dùng tự bấm, tool này không đẩy. Trần giờ mỗi ngày được cưỡng chế — vượt thì dòng bị cắt ' +
      'cho vừa và kết quả nói rõ. Gọi logtime_projects trước nếu chưa chắc tên dự án.',
    parameters: AddParams,
    async execute(_id, params): Promise<AgentToolResult<{ added: boolean }>> {
      const r = await runLogtimeAdd(params)
      return {
        content: [{ type: 'text', text: r.text }],
        details: { added: !r.isError, ...(r.isError ? { isError: true } : {}) },
      }
    },
  }

  const removeTool: AgentTool<typeof RemoveParams, { removed: boolean }> = {
    name: 'logtime_remove',
    label: 'Logtime remove',
    description:
      'Xoá một dòng công NHÁP theo id. Dòng đã đẩy lên PMS không xoá được bằng tool này — nó còn ' +
      'sống trên PMS, người dùng phải xoá bên đó.',
    parameters: RemoveParams,
    async execute(_id, params): Promise<AgentToolResult<{ removed: boolean }>> {
      const r = await runLogtimeRemove(params)
      return {
        content: [{ type: 'text', text: r.text }],
        details: { removed: !r.isError, ...(r.isError ? { isError: true } : {}) },
      }
    },
  }

  return [dayTool, projectsTool, addTool, removeTool] as AgentTool[]
}
