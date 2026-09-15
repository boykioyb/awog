// Lược đồ "bảng điều khiển tự lắp" (mốc 6, M4).
//
// VÌ SAO JSON, KHÔNG PHẢI MARKDOWN + FRONTMATTER NHƯ PLAYBOOK. Một playbook là thứ
// người ta ĐỌC và commit vào repo, nên nó phải mở được bằng trình soạn thảo nào
// cũng ra. Một bảng điều khiển thì không: ruột của nó là quy cách vẽ — namespace,
// metric, stat, dimension — tức trạng thái MÁY, không phải văn bản. Bắt người dùng
// đọc một khối ```json bọc trong frontmatter chỉ để ghim bốn biểu đồ là thêm một
// tầng mà không ai dùng.
//
// `id` suy từ TÊN FILE, `tier` suy từ THƯ MỤC — không bao giờ ghi vào trong file.
// Cùng luật với playbook (`playbook/store.ts`) và wiki: một file copy sang tier khác
// mà vẫn mang tier cũ trong ruột là một lời nói dối nằm trên đĩa.
//
// ĐỌC LÀ DỮ LIỆU L1. File người dùng sửa tay được, nên `validateDashboard` soi lại
// trước khi vào `Dashboard`; `list` trả về dòng kèm `issues` thay vì bỏ qua im lặng.

import { z } from 'zod'
import { isValidStat } from '../aws/metrics.js'

// ─── Trần ───────────────────────────────────────────────────────────────────

/**
 * Số biểu đồ tối đa của MỘT bảng. Mười hai là hai lưới ba cột — quá đó thì không
 * ai nhìn, và một payload IPC bịa ra 5000 biểu đồ vẫn phải bị cắt trước khi vào RAM.
 */
export const MAX_CHARTS_PER_DASHBOARD = 12

/** Số chuỗi tối đa của MỘT biểu đồ. Bốn là mức cao nhất có thật trong màn Giám sát
 *  (p50/p95/p99 là ba). Sáu chừa chỗ cho một biểu đồ ghép tay mà vẫn còn đọc được. */
export const MAX_SERIES_PER_CHART = 6

/**
 * Trần chuỗi của CẢ bảng, khớp `MAX_SERIES_PER_REQUEST` của `aws/metrics.ts`.
 *
 * Đây không phải một con số làm đẹp: bảng nạp bằng một lời gọi cho mỗi VÙNG (bốn
 * biểu đồ của màn Giám sát đi trong đúng một lô — luật số 2 của `useInfraMetrics`).
 * Một bảng vượt trần này sẽ bị `infra.metrics-query` từ chối nguyên lượt, nên phải
 * chặn ở lúc LƯU chứ không phải lúc NẠP.
 */
export const MAX_SERIES_PER_DASHBOARD = 24

/** Trần ký tự của tiêu đề/nhãn — đủ cho tên người, không đủ cho một đoạn văn. */
export const MAX_LABEL_CHARS = 200

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export function isValidDashboardId(id: string): boolean {
  return ID_RE.test(id)
}

// ─── Hình dạng ──────────────────────────────────────────────────────────────

export const DASHBOARD_KINDS = ['line', 'area', 'bar'] as const
export type DashboardChartKind = (typeof DASHBOARD_KINDS)[number]

/** `builtin` sống trong mã, hai tier kia nằm trên đĩa (xem `store.ts`). */
export const DASHBOARD_SOURCES = ['builtin', 'global', 'project'] as const
export type DashboardSource = (typeof DASHBOARD_SOURCES)[number]

export type DashboardTier = 'global' | 'project'

export type DashboardDimension = { name: string; value: string }

/**
 * Loại tài nguyên mà một chuỗi lọc theo. Tên dimension thật của CloudWatch
 * (`LoadBalancer`/`InstanceId`) KHÔNG ở đây: nó là tri thức của lúc DỰNG QUERY, và
 * query do UI dựng (`TARGET_DIMENSIONS` ở `useInfraMetrics.ts`) — chỗ duy nhất cần
 * biết. Sidecar chỉ giữ thứ nằm trên đĩa.
 */
export const DASHBOARD_TARGETS = ['lb', 'instance'] as const
export type DashboardTarget = (typeof DASHBOARD_TARGETS)[number]

export type DashboardSeries = {
  /** Danh tính của chuỗi trong MỘT bảng — xem luật ở `validateDashboard`. */
  key: string
  namespace: string
  metricName: string
  /** `Average` · `Sum` · `p95` … Như nhau với `MetricQuery.stat`. */
  stat: string
  label: string
  /** Chuỗi CSS hoặc `var(--…)`. SVG nhận `var()` trong `:style`, không trong thuộc
   *  tính — nên giá trị này chảy vào style chứ không vào attribute. */
  color: string
  /** Bậc đậm nhạt cho dữ liệu CÓ THỨ TỰ (p50 < p95 < p99): một hue, ba bậc. */
  shade: number
  /**
   * Dimension CỐ ĐỊNH — giá trị nằm luôn trong file (vd `Currency=USD` của
   * `AWS/Billing`). Dimension của tài nguyên thì KHÔNG đi đường này: ghim cứng tên
   * một ALB vào file là một quả mìn cho bảng 2 tier (bảng global mở ở tài khoản
   * khác sẽ trắng, và trắng im lặng).
   */
  dimensions: DashboardDimension[]
  /** Dimension của series này lấy từ TÀI NGUYÊN ĐANG CHỌN ở ngữ cảnh (`lb`/`instance`). */
  target?: DashboardTarget | undefined
  /**
   * Giá trị điền SẴN cho `target` khi mở bảng — cái đã có trên màn lúc bấm "Ghim".
   * Là gợi ý, KHÔNG phải ràng buộc: người dùng đổi được trong bảng, và đó chính là
   * chỗ nó khác một dimension cố định.
   */
  targetValue?: string | undefined
}

export type DashboardChart = {
  key: string
  title: string
  kind: DashboardChartKind
  unit: string
  /**
   * Vùng ĐỌC của riêng biểu đồ này, khi khác vùng của ngữ cảnh.
   *
   * Có mặt vì `AWS/Billing` (`EstimatedCharges` — mẫu "Chi phí") CHỈ được phát ở
   * `us-east-1`. Không có ô này thì mẫu Chi phí trắng với mọi người dùng có ngữ
   * cảnh ngoài us-east-1, tức gần như tất cả — và nó trắng một cách im lặng, vì
   * `get-metric-data` trả rỗng chứ không báo lỗi khi sai vùng.
   */
  region?: string | undefined
  series: DashboardSeries[]
}

export type Dashboard = {
  id: string
  name: string
  description: string
  tier: DashboardTier
  updatedAt: string
  charts: DashboardChart[]
}

export type DashboardIssue = { code: string; message: string }

export type DashboardDraft = {
  name: string
  description: string
  charts: DashboardChart[]
}

// ─── Lược đồ zod ────────────────────────────────────────────────────────────

const ShortText = z.string().max(MAX_LABEL_CHARS)
const Identity = z.string().min(1).max(255)

const DimensionSchema = z.object({
  name: Identity,
  value: z.string().min(1).max(1024),
})

const SeriesSchema = z.object({
  key: z.string().min(1).max(64),
  namespace: Identity,
  metricName: Identity,
  stat: z.string().min(1).max(16),
  label: ShortText,
  color: z.string().min(1).max(64),
  shade: z.number().min(0).max(1),
  dimensions: z.array(DimensionSchema).max(30),
  target: z.enum(DASHBOARD_TARGETS).optional(),
  targetValue: z.string().min(1).max(1024).optional(),
})

const ChartSchema = z.object({
  key: z.string().min(1).max(64),
  title: ShortText,
  kind: z.enum(DASHBOARD_KINDS),
  unit: z.string().max(32),
  region: z.string().min(1).max(64).optional(),
  series: z.array(SeriesSchema).min(1).max(MAX_SERIES_PER_CHART),
})

export const DashboardDraftSchema = z.object({
  name: z.string().min(1).max(MAX_LABEL_CHARS),
  description: ShortText,
  charts: z.array(ChartSchema).min(1).max(MAX_CHARTS_PER_DASHBOARD),
})

// ─── Kiểm cấu trúc ──────────────────────────────────────────────────────────

/**
 * Những luật zod KHÔNG nói được: duy nhất, và ràng buộc xuyên biểu đồ.
 *
 * Lỗi ở đây là lỗi người-dùng-viết-sai, nên chúng quay về dưới dạng `issues` chứ
 * không phải ngoại lệ (quy ước đầu `methods/infra.playbook.ts`).
 */
export function validateDashboard(dashboard: Dashboard): DashboardIssue[] {
  const issues: DashboardIssue[] = []

  if (!isValidDashboardId(dashboard.id)) {
    issues.push({ code: 'dashboard.error.badId', message: `id: ${dashboard.id}` })
  }

  const chartKeys = new Set<string>()
  // Khoá chuỗi phải duy nhất trên TOÀN BẢNG, không phải trong từng biểu đồ: lượt nạp
  // dựng MỘT mảng query cho mỗi vùng và ghép series trả về với biểu đồ qua `key`.
  // Hai chuỗi trùng khoá thì `Map` của tầng nạp giữ cái sau, và biểu đồ kia vẽ dữ
  // liệu của hàng xóm — một cách im lặng.
  const seriesKeys = new Set<string>()
  let seriesCount = 0

  for (const chart of dashboard.charts) {
    if (chartKeys.has(chart.key)) {
      issues.push({ code: 'dashboard.error.duplicateChart', message: `chart: ${chart.key}` })
    }
    chartKeys.add(chart.key)

    for (const s of chart.series) {
      seriesCount += 1
      if (seriesKeys.has(s.key)) {
        issues.push({ code: 'dashboard.error.duplicateSeries', message: `series: ${s.key}` })
      }
      seriesKeys.add(s.key)

      if (!isValidStat(s.stat)) {
        issues.push({ code: 'dashboard.error.badStat', message: `series: ${s.key} · ${s.stat}` })
      }

      // `targetValue` không có `target` là một giá trị điền sẵn mà không ai đọc —
      // nó biến mất lúc nạp và người dùng tưởng bảng đã ghim tài nguyên.
      if (s.targetValue !== undefined && s.target === undefined) {
        issues.push({ code: 'dashboard.error.orphanTargetValue', message: `series: ${s.key}` })
      }
    }
  }

  if (seriesCount > MAX_SERIES_PER_DASHBOARD) {
    issues.push({
      code: 'dashboard.error.tooManySeries',
      message: `${seriesCount} > ${MAX_SERIES_PER_DASHBOARD}`,
    })
  }

  return issues
}

/**
 * Dựng `Dashboard` từ một bản nháp đã qua zod. `id`/`tier` đến từ ĐƯỜNG DẪN, không
 * từ ruột file — xem đầu file.
 */
export function buildDashboard(
  draft: DashboardDraft,
  meta: { id: string; tier: DashboardTier; updatedAt: string },
): Dashboard {
  return {
    id: meta.id,
    name: draft.name.trim(),
    description: draft.description.trim(),
    tier: meta.tier,
    updatedAt: meta.updatedAt,
    charts: draft.charts.map((c) => ({
      key: c.key,
      title: c.title.trim(),
      kind: c.kind,
      unit: c.unit,
      ...(c.region !== undefined ? { region: c.region } : {}),
      series: c.series.map((s) => ({
        key: s.key,
        namespace: s.namespace,
        metricName: s.metricName,
        stat: s.stat,
        label: s.label,
        color: s.color,
        shade: s.shade,
        dimensions: s.dimensions.map((d) => ({ name: d.name, value: d.value })),
        ...(s.target !== undefined ? { target: s.target } : {}),
        ...(s.targetValue !== undefined ? { targetValue: s.targetValue } : {}),
      })),
    })),
  }
}
