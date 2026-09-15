// Hình dạng dữ liệu của Graph kiến trúc (Mốc 5) — HỢP ĐỒNG giữa sidecar và UI.
//
// File này là bản chép ĐÚNG §3 của `.awog/scratch/moc5-contract.md`. Workstream UI
// code song song dựa trên hình dạng này, nên đổi tên trường ở đây là làm hỏng việc
// của người khác — thấy sai thì báo lại trong báo cáo, đừng sửa lặng lẽ.
//
// `InfraGraphBlocked` (§2 của hợp đồng) cố ý nằm ở đây chứ không ở một file dùng
// chung: hợp đồng nói shape đó dùng CHUNG cho cả graph lẫn playbook, nhưng ranh
// giới file của Mốc 5 không cho workstream nào tạo file chung — nên mỗi bên khai
// một bản. Hai bản phải khớp từng trường; lệch là UI không dùng chung được hộp
// duyệt.

import type { InfraCommandClass } from '../types.js'

/** Node của AWS (đi tiếp được) hay thứ nằm NGOÀI phạm vi đang ghim. */
export type InfraGraphNodeKind = 'service' | 'external'

export type InfraGraphNode = {
  /** Bền vững: `${service}:${region}:${tên}` — cũng là thứ `graph-expand` nhận. */
  id: string
  /** 'route53' | 'cloudfront' | 'apigateway' | 'lambda' | 'ecs' | 'rds' | 'sqs'… */
  service: string
  /** Tên người dùng đọc được, ĐÃ redact. */
  label: string
  region: string
  kind: InfraGraphNodeKind
  /** Dựng từ cấu hình/env, không phải liên kết AWS kể ra được. */
  inferred: boolean
  /** Resolver còn bước nữa cho node này. */
  expandable: boolean
  /** Ít khoá, hiện được trong panel node. */
  detail: Record<string, string>
}

export type InfraGraphEdgeSource = 'describe' | 'traffic' | 'config'

/**
 * Nhãn cạnh. `string` theo hợp đồng, nhưng tầng resolver chỉ phát ra đúng bộ giá
 * trị dưới đây — UI dịch nhãn theo khoá này, nên một nhãn tự do ở đây là một khoá
 * i18n không tồn tại.
 */
export const INFRA_GRAPH_EDGE_LABELS = ['alias', 'origin', 'behavior', 'target', 'env'] as const

export type InfraGraphEdgeLabel = (typeof INFRA_GRAPH_EDGE_LABELS)[number]

export type InfraGraphEdge = {
  /** `${from}|${to}|${label}|${khoá phụ}` — khoá phụ phân biệt nhiều cạnh cùng cặp. */
  id: string
  from: string
  to: string
  label: string
  /** `true` ⇒ UI vẽ NÉT ĐỨT. */
  inferred: boolean
  source: InfraGraphEdgeSource
}

/** Nguồn của lớp lưu lượng — UI PHẢI nói đang dùng nguồn nào. */
export type InfraTrafficSource = 'xray' | 'cloudwatch' | 'none'

export type InfraGraph = {
  nodes: InfraGraphNode[]
  edges: InfraGraphEdge[]
  /** Node id mà lần dựng này bắt đầu từ đó. */
  roots: string[]
  /** Trần độ sâu đã dùng cho lần dựng này. */
  depth: number
  /** Chạm trần độ sâu — còn nhánh chưa dựng. */
  truncated: boolean
  trafficSource: InfraTrafficSource
  /** Khoá i18n cho những thứ bị bỏ qua (kèm nguồn lưu lượng đang dùng). */
  notes: string[]
}

export type InfraGraphRoot = {
  id: string
  service: string
  label: string
  region: string
}

/**
 * Kết quả khi cổng quyền chặn — §2 của hợp đồng, dùng chung với playbook.
 *
 * `requiresApproval === false` = ma trận chặn hẳn, UI KHÔNG được mời gọi lại.
 */
export type InfraGraphBlocked = {
  ok: false
  blocked: true
  requiresApproval: boolean
  /** Chỉ có khi `requiresApproval`. */
  approvalTicket?: string
  command: string
  reason: string
  class: InfraCommandClass
  accountKind: 'normal' | 'production'
  mode: 'auto' | 'ask' | 'block'
}

/**
 * Trần độ sâu của MỘT lần dựng (task 5.3). Chạm trần ⇒ `truncated: true` + khoá
 * i18n trong `notes`, và node ở đúng trần có `expandable: false` để UI không mời
 * người dùng bấm vào một nút không làm gì.
 */
export const INFRA_GRAPH_MAX_DEPTH = 4
