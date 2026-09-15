// `infra.dashboard-*` — bề mặt RPC của bảng điều khiển tự lắp (mốc 6, M4).
//
// BỐN method, và không có method nào gọi CLI. Một bảng điều khiển chỉ là một tờ
// quy cách vẽ được lưu lại: đọc nó ra thì không tốn tiền, chỉ lượt NẠP số liệu mới
// tốn — và lượt đó đi qua `infra.metrics-query` đã có, với `surface: 'dashboards'`
// để sổ kiểm toán biết lượt trả tiền ấy do ai bấm.
//
// MỘT QUY ƯỚC XUYÊN SUỐT FILE: câu trả lời cho một thất bại ĐÃ LƯỜNG TRƯỚC là một
// object `{ ok: false, ... }`, không phải một ngoại lệ. "File người dùng viết sai",
// "không có bảng tên đó" đều là câu trả lời bình thường của một câu hỏi hợp lệ;
// ngoại lệ để dành cho sự cố thật (đĩa hỏng, tham số sai kiểu).

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { BUILTIN_DASHBOARDS, builtinDashboard } from '../infra/dashboard/builtin.js'
import {
  deleteDashboard,
  listDashboards,
  readDashboard,
  saveDashboard,
  summarizeDashboard,
} from '../infra/dashboard/store.js'
import {
  DashboardDraftSchema,
  buildDashboard,
  isValidDashboardId,
  validateDashboard,
} from '../infra/dashboard/schema.js'
import type { Dashboard, DashboardIssue, DashboardSource } from '../infra/dashboard/schema.js'
import type { DashboardSummary } from '../infra/dashboard/store.js'

// ─── Tham số ─────────────────────────────────────────────────────────────────

const SOURCE = z.enum(['builtin', 'global', 'project'])
const WRITABLE_SOURCE = z.enum(['global', 'project'])

const Id = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidDashboardId, 'dashboard.error.badId')
const ProjectId = z.string().min(1).max(200).optional()

const Scope = z.object({ source: SOURCE, projectId: ProjectId, id: Id })

// ─── Hình dạng trả về ────────────────────────────────────────────────────────

export type DashboardListResult = { ok: true; dashboards: DashboardSummary[] }

export type DashboardReadResult =
  | { ok: true; dashboard: Dashboard }
  | { ok: false; error: string; issues?: DashboardIssue[] }

export type DashboardSaveResult =
  | { ok: true; dashboard: Dashboard }
  | { ok: false; error: string; issues?: DashboardIssue[] }

export type DashboardDeleteResult = { ok: true } | { ok: false; error: string }

// ─── Nạp một bảng ────────────────────────────────────────────────────────────

type Resolved = { dashboard: Dashboard } | { error: string; issues?: DashboardIssue[] }

/**
 * Bảng dựng sẵn nằm trong MÃ, không trên đĩa, nên nhánh `builtin` phải rẽ TRƯỚC khi
 * chạm filesystem. Cùng một id ở hai tier là hai bảng khác nhau, nên `source` luôn
 * là một phần của khoá — không bao giờ suy ra từ kết quả dò.
 */
async function resolveDashboard(
  source: DashboardSource,
  projectId: string | undefined,
  id: string,
): Promise<Resolved> {
  if (source === 'builtin') {
    const d = builtinDashboard(id)
    return d ? { dashboard: d } : { error: 'dashboard.error.notFound' }
  }
  const parsed = await readDashboard(source, projectId, id)
  if (!parsed) return { error: 'dashboard.error.notFound' }
  if (!parsed.ok) return { error: 'dashboard.error.invalid', issues: parsed.issues }
  return { dashboard: parsed.dashboard }
}

// ─── Quản lý bảng điều khiển ─────────────────────────────────────────────────

register('infra.dashboard-list', async (raw): Promise<DashboardListResult> => {
  const p = z
    .object({ projectIds: z.array(z.string().min(1).max(200)).max(50).default([]) })
    .parse(raw)
  const builtins = BUILTIN_DASHBOARDS.map((d) => summarizeDashboard(d, 'builtin'))
  return { ok: true, dashboards: [...builtins, ...(await listDashboards(p.projectIds))] }
})

register('infra.dashboard-read', async (raw): Promise<DashboardReadResult> => {
  const p = Scope.parse(raw)
  const resolved = await resolveDashboard(p.source, p.projectId, p.id)
  if ('error' in resolved) {
    return {
      ok: false,
      error: resolved.error,
      ...(resolved.issues !== undefined ? { issues: resolved.issues } : {}),
    }
  }
  return { ok: true, dashboard: resolved.dashboard }
})

register('infra.dashboard-save', async (raw): Promise<DashboardSaveResult> => {
  const p = z
    .object({
      source: WRITABLE_SOURCE,
      projectId: ProjectId,
      id: Id,
      draft: DashboardDraftSchema,
    })
    .parse(raw)

  // Kiểm Ở ĐÂY để lỗi người-dùng-viết-sai ra về dưới dạng `{ ok: false, issues }`
  // thay vì một ngoại lệ (xem quy ước đầu file). `saveDashboard` chạy lại đúng phép
  // kiểm này và ném — nó không thể ném ở lượt gọi này, vì ta vừa đi qua cửa đó.
  const tier = p.source === 'project' ? 'project' : 'global'
  const issues = validateDashboard(
    buildDashboard(p.draft, { id: p.id, tier, updatedAt: new Date().toISOString() }),
  )
  if (issues.length > 0) return { ok: false, error: 'dashboard.error.invalid', issues }

  const saved = await saveDashboard({
    source: p.source,
    ...(p.projectId !== undefined ? { projectId: p.projectId } : {}),
    id: p.id,
    draft: p.draft,
  })
  return { ok: true, dashboard: saved }
})

register('infra.dashboard-delete', async (raw): Promise<DashboardDeleteResult> => {
  const p = Scope.parse(raw)
  if (p.source === 'builtin') return { ok: false, error: 'dashboard.error.builtinReadOnly' }
  await deleteDashboard(p.source, p.projectId, p.id)
  return { ok: true }
})
