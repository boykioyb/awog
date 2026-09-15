// BA BẢNG DỰNG SẴN (mốc 6, M4) — Website · API · Chi phí.
//
// Chúng sống trong MÃ, không nằm trên đĩa: người dùng không sửa được bản gốc, chỉ
// fork ra một bảng của mình (lưu vào `~/.awog/dashboards` hoặc
// `{project}/.awog/dashboards`) — cùng luật với `playbook/builtin.ts`, và cũng là
// lý do chúng được trả ở `source: 'builtin'` chứ không có `tier` trên đĩa.
//
// BA LUẬT RÚT TỪ `infra-monitoring-reports.md` §"Luật vẽ biểu đồ", áp ngay ở đây:
//   1. KHÔNG hai trục y. Lượt gọi và tỉ lệ lỗi là hai thang đo khác nhau ⇒ hai
//      biểu đồ, chung một trục thời gian. Không mẫu nào ghép chúng.
//   2. Dữ liệu CÓ THỨ TỰ dùng một hue đậm dần — p50/p95/p99 là `var(--blue)` ba bậc
//      (`shade` 0.4/0.7/1), không phải ba màu.
//   3. Màu trạng thái là của riêng trạng thái: không mẫu nào mượn
//      `--danger`/`--amber`/`--green` làm "chuỗi thứ tư".
//
// ⚠ MỘT ĐIỀU PHẢI NÓI TRƯỚC VỀ MẪU "CHI PHÍ". Nó đọc `AWS/Billing` — KHÔNG phải
// Cost Explorer (chưa nối; ô "chi phí tháng" ở màn Giám sát vẫn ghi "chưa có
// nguồn"). `EstimatedCharges` là con số CloudWatch THẬT nên đi được qua đúng đường
// `get-metric-data` đã có — không thêm lệnh, không thêm quyền, không thêm parser.
// Ba hệ quả, và cả ba đều nằm trong `description` của bảng để người dùng đọc được
// chứ không phải đoán:
//   · `AWS/Billing` CHỈ được phát ở `us-east-1` ⇒ mỗi biểu đồ ghim `region`.
//   · Phải bật "Receive Billing Alerts" trong tài khoản thì metric mới tồn tại.
//   · Đây là ước tính LŨY KẾ TỪ ĐẦU THÁNG, không phải hoá đơn. Vì vậy stat là
//     `Maximum`, không phải `Average`: đường bậc thang này chỉ tăng, lấy trung bình
//     qua các kỳ sẽ kéo con số hiện tại xuống thấp hơn sự thật.
//
// VÌ SAO KHÔNG CÓ DIMENSION TÀI NGUYÊN Ở ĐÂY. Bốn biểu đồ của Website/API lọc theo
// `LoadBalancer`, nhưng giá trị đó KHÔNG nằm trong file: nó là `target: 'lb'`, lấy
// từ tài nguyên người dùng chọn ở ngữ cảnh đang ghim. Ghim cứng một tên ALB vào
// bảng global là một quả mìn — mở ở tài khoản khác thì biểu đồ trắng, và trắng im
// lặng vì `get-metric-data` trả rỗng chứ không báo lỗi.

import type { Dashboard, DashboardChart, DashboardDimension, DashboardSeries } from './schema.js'

// Bảng dựng sẵn đi kèm bản app, không có lần sửa nào để đóng dấu — hằng số này chỉ
// để `updatedAt` là ISO hợp lệ và ỔN ĐỊNH giữa các máy (một `new Date()` ở đây làm
// danh sách đổi mỗi lần khởi động lại).
const BUILTIN_UPDATED_AT = '2026-09-15T00:00:00.000Z'

// ─── Định danh metric dùng lại nhiều lần ────────────────────────────────────

const ALB = 'AWS/ApplicationELB'
const BILLING = 'AWS/Billing'
/** `AWS/Billing` chỉ tồn tại ở đây — xem đầu file. */
const BILLING_REGION = 'us-east-1'

/** Một chuỗi lọc theo tài nguyên của ngữ cảnh (`target`), không dimension cứng. */
function targeted(
  key: string,
  metricName: string,
  stat: string,
  label: string,
  color: string,
  shade: number,
): DashboardSeries {
  return { key, namespace: ALB, metricName, stat, label, color, shade, dimensions: [], target: 'lb' }
}

/** Một chuỗi với dimension CỐ ĐỊNH — dùng cho `AWS/Billing`, nơi dimension là
 *  `Currency`/`ServiceName` chứ không phải một tài nguyên của người dùng. */
function fixed(
  key: string,
  metricName: string,
  stat: string,
  label: string,
  color: string,
  shade: number,
  dimensions: DashboardDimension[],
): DashboardSeries {
  return { key, namespace: BILLING, metricName, stat, label, color, shade, dimensions }
}

function chart(
  key: string,
  title: string,
  kind: DashboardChart['kind'],
  unit: string,
  series: DashboardSeries[],
  region?: string,
): DashboardChart {
  return {
    key,
    title,
    kind,
    unit,
    ...(region !== undefined ? { region } : {}),
    series,
  }
}

// ─── A. Website ─────────────────────────────────────────────────────────────
//
// Bốn câu hỏi của một website đang chạy: có ai vào không (lượt gọi), vào có lỗi
// không (5XX), vào có chậm không (p95), và trả về bao nhiêu dữ liệu (băng thông).
// Bốn câu, bốn thang đo — nên bốn biểu đồ, không ghép.

const WEBSITE: Dashboard = {
  id: 'website',
  name: 'Website',
  description:
    'Sức khoẻ một website sau cân bằng tải: lượt gọi, lỗi máy chủ, độ trễ p95 và băng thông. ' +
    'Chọn tài nguyên LoadBalancer ở thanh ngữ cảnh trước khi nạp — biểu đồ lọc theo tài nguyên đó.',
  tier: 'global',
  updatedAt: BUILTIN_UPDATED_AT,
  charts: [
    chart(
      'calls',
      'Lượt gọi',
      'area',
      'Count',
      [targeted('w-calls', 'RequestCount', 'Sum', 'RequestCount', 'var(--accent)', 1)],
    ),
    chart(
      'server-errors',
      'Lỗi máy chủ (5XX)',
      'bar',
      'Count',
      [
        targeted(
          'w-5xx',
          'HTTPCode_Target_5XX_Count',
          'Sum',
          '5XX',
          'var(--accent)',
          1,
        ),
      ],
    ),
    chart('latency', 'Độ trễ p95', 'line', 'Seconds', [
      targeted('w-p95', 'TargetResponseTime', 'p95', 'p95', 'var(--blue)', 1),
    ]),
    chart('bytes', 'Băng thông', 'area', 'Bytes', [
      targeted('w-bytes', 'ProcessedBytes', 'Sum', 'ProcessedBytes', 'var(--violet)', 1),
    ]),
  ],
}

// ─── B. API ─────────────────────────────────────────────────────────────────
//
// Khác Website ở chỗ hỏi về HÌNH DẠNG của độ trễ (phân vị) và về phía CLIENT
// (4XX), chứ không phải về lưu lượng. p50/p95/p99 nằm CHUNG một khung vì chúng
// cùng một thang đo — đó đúng là trường hợp luật 2 sinh ra để phục vụ.

const API: Dashboard = {
  id: 'api',
  name: 'API',
  description:
    'Một API sau cân bằng tải: dải phân vị độ trễ (p50/p95/p99), lỗi phía client, lỗi phía máy chủ ' +
    'và kết nối đang mở. Dải phân vị nằm chung một khung vì cùng thang đo — khoảng cách giữa ba ' +
    'đường là thứ cần đọc, không phải ba con số rời.',
  tier: 'global',
  updatedAt: BUILTIN_UPDATED_AT,
  charts: [
    chart('latency-band', 'Dải độ trễ p50 · p95 · p99', 'line', 'Seconds', [
      targeted('a-p50', 'TargetResponseTime', 'p50', 'p50', 'var(--blue)', 0.4),
      targeted('a-p95', 'TargetResponseTime', 'p95', 'p95', 'var(--blue)', 0.7),
      targeted('a-p99', 'TargetResponseTime', 'p99', 'p99', 'var(--blue)', 1),
    ]),
    chart('client-errors', 'Lỗi phía client (4XX)', 'bar', 'Count', [
      targeted('a-4xx', 'HTTPCode_Target_4XX_Count', 'Sum', '4XX', 'var(--accent)', 1),
    ]),
    chart('server-errors', 'Lỗi phía máy chủ (5XX)', 'bar', 'Count', [
      targeted('a-5xx', 'HTTPCode_Target_5XX_Count', 'Sum', '5XX', 'var(--accent)', 1),
    ]),
    chart('connections', 'Kết nối đang mở', 'area', 'Count', [
      targeted('a-conn', 'ActiveConnectionCount', 'Average', 'ActiveConnectionCount', 'var(--violet)', 1),
    ]),
  ],
}

// ─── C. Chi phí ─────────────────────────────────────────────────────────────
//
// HAI biểu đồ, và biểu đồ thứ hai CỐ Ý để giá trị mẫu là `AmazonEC2`: `ServiceName`
// là danh mục riêng của từng tài khoản (tên dịch vụ AWS, không phải do ta đặt), nên
// không có giá trị nào đúng cho mọi người. Một giá trị mẫu kèm câu chỉ đường thì
// dạy được cái khuôn; để trống thì biểu đồ trắng mà không nói vì sao.

const COST: Dashboard = {
  id: 'cost',
  name: 'Chi phí',
  description:
    'Chi phí ước tính luỹ kế từ đầu tháng, đọc từ metric AWS/Billing của CloudWatch. ' +
    'Ba điều kiện: tài khoản phải bật "Receive Billing Alerts", metric chỉ tồn tại ở us-east-1 ' +
    '(mỗi biểu đồ đã ghim vùng đó), và đây là ƯỚC TÍNH chứ không phải hoá đơn. ' +
    'Biểu đồ theo dịch vụ đang để sẵn AmazonEC2 — đổi thành dịch vụ bạn cần. ' +
    'Nếu tài khoản dùng đơn vị tiền khác USD, sửa dimension Currency.',
  tier: 'global',
  updatedAt: BUILTIN_UPDATED_AT,
  charts: [
    chart(
      'month-total',
      'Tổng chi phí tháng (ước tính)',
      'area',
      'USD',
      [
        fixed('c-total', 'EstimatedCharges', 'Maximum', 'EstimatedCharges', 'var(--accent)', 1, [
          { name: 'Currency', value: 'USD' },
        ]),
      ],
      BILLING_REGION,
    ),
    chart(
      'by-service',
      'Chi phí một dịch vụ',
      'line',
      'USD',
      [
        fixed('c-service', 'EstimatedCharges', 'Maximum', 'AmazonEC2', 'var(--blue)', 1, [
          { name: 'ServiceName', value: 'AmazonEC2' },
          { name: 'Currency', value: 'USD' },
        ]),
      ],
      BILLING_REGION,
    ),
  ],
}

export const BUILTIN_DASHBOARDS: readonly Dashboard[] = [WEBSITE, API, COST]

export function builtinDashboard(id: string): Dashboard | undefined {
  return BUILTIN_DASHBOARDS.find((d) => d.id === id)
}
