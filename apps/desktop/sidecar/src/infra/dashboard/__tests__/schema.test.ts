// `schema.ts` — định dạng bảng điều khiển + LUẬT CỨNG.
//
// Bốn tính chất được khoá ở đây là hàng rào, không phải tiện ích:
//   · khoá chuỗi duy nhất trên TOÀN BẢNG (trùng thì biểu đồ này vẽ dữ liệu của biểu đồ kia,
//     im lặng — tầng nạp ghép series trả về với biểu đồ qua `key`),
//   · `targetValue` không có `target` là một giá trị không ai đọc,
//   · `stat` phải là thứ CloudWatch nhận, vì sai thì `get-metric-data` trả RỖNG chứ không
//     báo lỗi,
//   · `id`/`tier` đến từ ĐƯỜNG DẪN chứ không từ ruột file, nên không trường nào trên đĩa
//     nói dối được về danh tính của bảng.
//
// Run với vitest: `npx vitest run src/infra/dashboard/__tests__/schema.test.ts`
import { describe, expect, it } from 'vitest'
import {
  DashboardDraftSchema,
  MAX_SERIES_PER_DASHBOARD,
  buildDashboard,
  isValidDashboardId,
  validateDashboard,
} from '../schema.js'
import type { Dashboard, DashboardSeries } from '../schema.js'

const META = { id: 'bang-thu', tier: 'global' as const, updatedAt: '2026-09-15T00:00:00.000Z' }

function series(over: Partial<DashboardSeries> = {}): DashboardSeries {
  return {
    key: 's1',
    namespace: 'AWS/ApplicationELB',
    metricName: 'RequestCount',
    stat: 'Sum',
    label: 'Requests',
    color: '--blue',
    shade: 1,
    dimensions: [],
    ...over,
  }
}

function dashboard(charts: Dashboard['charts']): Dashboard {
  return { ...META, name: 'Thử', description: '', charts }
}

describe('isValidDashboardId', () => {
  it('nhận slug thường và từ chối những gì không phải tên file an toàn', () => {
    expect(isValidDashboardId('bang-web')).toBe(true)
    expect(isValidDashboardId('b1')).toBe(true)
    // Bắt đầu bằng gạch, hoa, dấu chấm, và đường dẫn — bốn cách để một `id` từ UI
    // trở thành một chỗ ghi ngoài thư mục của nó.
    expect(isValidDashboardId('-bang')).toBe(false)
    expect(isValidDashboardId('Bang')).toBe(false)
    expect(isValidDashboardId('bang.web')).toBe(false)
    expect(isValidDashboardId('../bang')).toBe(false)
    expect(isValidDashboardId('')).toBe(false)
  })
})

describe('validateDashboard', () => {
  it('bảng hợp lệ không sinh vấn đề nào', () => {
    const d = dashboard([
      { key: 'c1', title: 'A', kind: 'line', unit: 'Count', series: [series()] },
      { key: 'c2', title: 'B', kind: 'area', unit: 'Count', series: [series({ key: 's2' })] },
    ])
    expect(validateDashboard(d)).toEqual([])
  })

  it('bắt khoá chuỗi trùng GIỮA HAI biểu đồ, không chỉ trong một biểu đồ', () => {
    const d = dashboard([
      { key: 'c1', title: 'A', kind: 'line', unit: 'Count', series: [series({ key: 'dup' })] },
      { key: 'c2', title: 'B', kind: 'line', unit: 'Count', series: [series({ key: 'dup' })] },
    ])
    expect(validateDashboard(d).map((i) => i.code)).toContain('dashboard.error.duplicateSeries')
  })

  it('bắt khoá biểu đồ trùng', () => {
    const d = dashboard([
      { key: 'c1', title: 'A', kind: 'line', unit: 'Count', series: [series()] },
      { key: 'c1', title: 'B', kind: 'line', unit: 'Count', series: [series({ key: 's2' })] },
    ])
    expect(validateDashboard(d).map((i) => i.code)).toContain('dashboard.error.duplicateChart')
  })

  it('bắt `targetValue` mồ côi và `stat` CloudWatch không nhận', () => {
    const d = dashboard([
      {
        key: 'c1',
        title: 'A',
        kind: 'line',
        unit: 'Count',
        series: [series({ targetValue: 'app/web/abc' }), series({ key: 's2', stat: 'Medianish' })],
      },
    ])
    const codes = validateDashboard(d).map((i) => i.code)
    expect(codes).toContain('dashboard.error.orphanTargetValue')
    expect(codes).toContain('dashboard.error.badStat')
  })

  it('`stat` phân vị `pNN` là hợp lệ — CloudWatch nhận, và mẫu độ trễ dùng nó', () => {
    const d = dashboard([
      { key: 'c1', title: 'A', kind: 'line', unit: 'Seconds', series: [series({ stat: 'p95' })] },
    ])
    expect(validateDashboard(d)).toEqual([])
  })

  it('đếm chuỗi theo TOÀN BẢNG, không theo từng biểu đồ', () => {
    // 5 biểu đồ × 5 chuỗi = 25 > 24: không biểu đồ nào vượt trần của riêng nó, nhưng
    // một lượt nạp thì vượt — đó chính là con số phải chặn.
    const charts = Array.from({ length: 5 }, (_, c) => ({
      key: `c${String(c)}`,
      title: `C${String(c)}`,
      kind: 'line' as const,
      unit: 'Count',
      series: Array.from({ length: 5 }, (_, s) => series({ key: `c${String(c)}s${String(s)}` })),
    }))
    const codes = validateDashboard(dashboard(charts)).map((i) => i.code)
    expect(codes).toContain('dashboard.error.tooManySeries')
    expect(25).toBeGreaterThan(MAX_SERIES_PER_DASHBOARD)
  })

  it('bắt `id` không hợp lệ — `id` đến từ tên file, nên đây là hàng rào cuối', () => {
    const d = { ...dashboard([]), id: '../thoat' }
    expect(validateDashboard(d).map((i) => i.code)).toContain('dashboard.error.badId')
  })
})

describe('buildDashboard', () => {
  it('lấy `id`/`tier` từ META và BỎ QUA thứ cùng tên trong ruột file', () => {
    const parsed = DashboardDraftSchema.parse({
      // Hai trường này không có trong lược đồ; zod strip chúng đi, và `buildDashboard`
      // cũng không đọc tới — file không tự khai được mình là bảng nào, ở tier nào.
      id: 'bang-gia-mao',
      tier: 'project',
      name: '  Thử  ',
      description: '  mô tả  ',
      charts: [{ key: 'c1', title: '  A  ', kind: 'line', unit: 'Count', series: [series()] }],
    })
    const built = buildDashboard(parsed, META)
    expect(built.id).toBe('bang-thu')
    expect(built.tier).toBe('global')
    // `trim` là một phần của hợp đồng: tên có khoảng trắng thừa sẽ lệch với tên hiện
    // trên danh sách, và người dùng không nhìn thấy khác biệt để tự sửa.
    expect(built.name).toBe('Thử')
    expect(built.description).toBe('mô tả')
    expect(built.charts[0]?.title).toBe('A')
  })

  it('bỏ hẳn trường tuỳ chọn thay vì ghi `undefined` — `exactOptionalPropertyTypes` và JSON trên đĩa', () => {
    const parsed = DashboardDraftSchema.parse({
      name: 'Thử',
      description: '',
      charts: [{ key: 'c1', title: 'A', kind: 'line', unit: 'Count', series: [series()] }],
    })
    const built = buildDashboard(parsed, META)
    expect('region' in built.charts[0]!).toBe(false)
    expect('target' in built.charts[0]!.series[0]!).toBe(false)
    expect('targetValue' in built.charts[0]!.series[0]!).toBe(false)
  })
})
