// G4 (nửa đầu) — từ một node của sơ đồ sang nhóm log của nó.
//
// VÌ SAO CẦN. Sơ đồ trả lời "request đi qua đâu"; Logs trả lời "chặng đó nói gì".
// Không có cầu nối này thì người dùng nhìn thấy node `checkout` rồi phải tự gõ lại
// `/aws/lambda/checkout` ở màn bên cạnh — và tự gõ sai là chuyện thường.
//
// LUẬT CỦA FILE NÀY: CHỈ SUY KHI AWS CÓ KHUÔN CỐ ĐỊNH, ngoài ra trả `null`.
// Một tên nhóm log đoán sai không báo lỗi — nó mở màn Logs ra trống trơn, và người
// đang chữa cháy sẽ đọc cái trống đó thành "chặng này không ghi gì", tức một kết
// luận sai về hệ thống của họ. Thà không có nút còn hơn có một nút nói dối.
//
// Ba mức, theo đúng thứ tự tin cậy:
//   1. `detail.logGroup` — do chính resolver đọc được từ cấu hình (ECS). Chính xác.
//   2. Khuôn AWS ép buộc — Lambda LUÔN ghi vào `/aws/lambda/<tên hàm>`. Chính xác.
//   3. Tiền tố khi phần đuôi phụ thuộc thứ sơ đồ không biết — API Gateway ghi vào
//      `API-Gateway-Execution-Logs_<id>/<stage>`, mà node không mang stage. Trả về
//      `prefix` để UI lọc danh sách nhóm thay vì mở thẳng một tên bịa ra.

/** Nhóm log của một node. `exact` mở thẳng được; `prefix` chỉ dùng để LỌC danh sách. */
export type NodeLogGroup = { kind: 'exact' | 'prefix'; value: string }

/** Phần node mà phép suy này cần — khai hẹp để test không phải dựng cả `InfraGraphNode`. */
export type LogGroupNodeInput = {
  /** `${service}:${region}:${tên tài nguyên}` — node KHÔNG có trường tên riêng. */
  id: string
  service: string
  detail?: Record<string, string> | undefined
}

/**
 * Tên tài nguyên trong `id`.
 *
 * Cùng luật cắt với `targetFromNodeId` ở `resolvers.ts`: chỉ HAI dấu `:` đầu là dấu
 * phân cách, phần còn lại là tên — vì tên được phép chứa `:` (ARN của task
 * definition ECS). Cắt bằng `split(':')` thường là cách làm hỏng đúng những node đó.
 */
function resourceName(id: string): string {
  const first = id.indexOf(':')
  if (first <= 0) return ''
  const second = id.indexOf(':', first + 1)
  if (second < 0) return ''
  return id.slice(second + 1)
}

/**
 * Nhóm log của một hàm Lambda, hoặc `null` khi tên không dùng được.
 *
 * MỘT NHÀ CHO LUẬT NÀY. Nhánh X-Ray của `logs/trace.ts` cũng phải suy đúng thứ này
 * từ tên segment, và bản đầu ở đó chép thiếu hai phép kiểm dưới đây — một segment
 * tên `orders/create` cho ra `/aws/lambda/orders/create`, rồi UI mời người dùng bấm
 * vào một nhóm log không thể tồn tại. Hai bản sao của một luật thì bản nào cũng có
 * thể là bản sai.
 *
 * `name` thường đã là TÊN HÀM (resolver tách sẵn từ ARN); lỡ còn nguyên ARN thì cắt
 * lấy phần sau `function:`. Còn `:` hoặc `/` sau khi cắt ⇒ đây không phải tên hàm,
 * và ghép bừa vào sau `/aws/lambda/` là dựng ra một nhóm chắc chắn không có thật.
 */
export function lambdaLogGroup(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return null
  const fromArn = /:function:([^:/]+)/.exec(trimmed)
  const fn = fromArn?.[1] ?? trimmed
  return fn.includes(':') || fn.includes('/') ? null : `/aws/lambda/${fn}`
}

/**
 * Tên nhóm log/ tiền tố của một node, hoặc `null` khi không suy được.
 *
 * ⚠ Không có nhánh `ecs` theo khuôn: AWS KHÔNG ép ECS ghi vào `/ecs/<gì đó>` — nhóm
 * do `logConfiguration.options['awslogs-group']` của task definition quyết định và
 * người ta đặt tên tuỳ ý. Nhánh ECS vì thế chỉ chạy được qua mức 1 (`detail.logGroup`,
 * do `ecsResolver` đọc từ chính task definition).
 */
export function logGroupForNode(node: LogGroupNodeInput): NodeLogGroup | null {
  const declared = node.detail?.['logGroup']?.trim()
  if (declared) return { kind: 'exact', value: declared }

  const name = resourceName(node.id).trim()
  if (name === '') return null

  if (node.service === 'lambda') {
    const group = lambdaLogGroup(name)
    return group ? { kind: 'exact', value: group } : null
  }

  if (node.service === 'apigateway' || node.service === 'apigatewayv2') {
    // Log thực thi của API Gateway: `API-Gateway-Execution-Logs_<apiId>/<stage>`.
    // Node không mang stage nên đây là TIỀN TỐ, không phải tên.
    return /^[A-Za-z0-9]+$/.test(name)
      ? { kind: 'prefix', value: `API-Gateway-Execution-Logs_${name}/` }
      : null
  }

  return null
}
