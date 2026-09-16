// Vỏ mỏng kiểu-hoá quanh ba RPC của màn Graph kiến trúc (Mốc 5, hợp đồng §3).
// Khuôn `useInfraCicdApi.ts`: một hàm cho một method, kiểu khớp HỢP ĐỒNG đã đóng
// băng ở sidecar — không tự đổi tên, không tự đổi hình dạng.
//
// LUẬT CỦA BỀ MẶT NÀY. `roots`/`resolve`/`expand` đều chạy resolver THẬT (nhiều
// lệnh `describe-*` qua cổng `runGated`), nên không hàm nào ở đây được gọi từ
// `onMounted`/`watch` — mỗi lời gọi đứng sau một cú bấm của người dùng.
//
// Resolver chạy chỉ-đọc nhưng vẫn đi qua cổng quyền: ma trận có thể siết lớp `read`
// trên tài khoản production, nên cả ba hàm đều có thể trả về `blocked` (§2).
import { useSidecar } from './useSidecar'

// ── Hình dạng node/edge/graph (hợp đồng §3) ───────────────────────────────────

export type InfraGraphNodeKind = 'service' | 'external'

export type InfraGraphNode = {
  /** Bền vững: `${service}:${region}:${tên}`. */
  id: string
  /** 'route53' | 'cloudfront' | 'apigateway' | 'lambda' | 'ecs' | 'rds' | … */
  service: string
  /** Tên người dùng đọc được, ĐÃ redact ở sidecar. */
  label: string
  region: string
  kind: InfraGraphNodeKind
  /** Dựng từ cấu hình/env, không phải liên kết AWS kể ra được. */
  inferred: boolean
  /** Resolver còn bước nữa cho node này. */
  expandable: boolean
  detail: Record<string, string>
  /**
   * Nhóm log của node, do sidecar suy ở `graph/log-groups.ts` (G4). VẮNG MẶT khi
   * không suy được — và vắng mặt là một câu trả lời: UI ẩn nút "xem log" thay vì
   * mở màn Logs với một tên nhóm bịa ra.
   *
   * `prefix` dùng để LỌC danh sách nhóm (API Gateway: node không mang stage nên
   * tên đầy đủ chỉ có sau khi người dùng chọn), `exact` mở thẳng được.
   */
  logGroup?: { kind: 'exact' | 'prefix'; value: string }
}

export type InfraGraphEdgeSource = 'describe' | 'traffic' | 'config'

export type InfraGraphEdge = {
  id: string
  from: string
  to: string
  /** 'origin' | 'behavior' | 'target' | 'env' | 'alias'. */
  label: string
  /** true ⇒ UI vẽ NÉT ĐỨT và nhãn nói rõ là suy luận. */
  inferred: boolean
  source: InfraGraphEdgeSource
}

export type InfraTrafficSource = 'xray' | 'cloudwatch' | 'none'

export type InfraGraph = {
  nodes: InfraGraphNode[]
  edges: InfraGraphEdge[]
  /** Node id mà lần dựng này bắt đầu từ đó. */
  roots: string[]
  /** Độ sâu đã dựng (trần 4). */
  depth: number
  /** Chạm trần độ sâu — UI phải NÓI RA, không im lặng cắt. */
  truncated: boolean
  /** UI PHẢI nói đang dùng nguồn lưu lượng nào. */
  trafficSource: InfraTrafficSource
  /** Khoá i18n cho những thứ bị bỏ qua. */
  notes: string[]
}

export type InfraGraphRoot = {
  id: string
  service: string
  label: string
  region: string
}

/** Ngữ cảnh AWS đi kèm mọi lời gọi — sidecar chèn nó vào argv, UI không thêm cờ. */
export type GraphContext = {
  profile?: string
  region?: string
  accountId?: string
}

// ── Kết quả (ba kết cục, phân biệt được bằng `ok`/`blocked`) ──────────────────

/** Cổng quyền chặn (§2): UI mở hộp duyệt rồi gọi lại ĐÚNG payload kèm vé này. */
export type GraphBlocked = {
  ok: false
  blocked: true
  requiresApproval: boolean
  approvalTicket?: string
  command: string
  reason: string
  class: string
  /** `production` ⇒ hộp duyệt đổi màu. */
  accountKind: 'normal' | 'production'
  mode: 'auto' | 'ask' | 'block'
}

type GraphFailed = { ok: false; blocked: false; error: string }

/**
 * Hình dạng THÔ trên dây: lượt bị cổng chặn có thể tới KHÔNG kèm `ok` (sidecar trả
 * `{blocked: true, …}`). Giữ đúng sự thật đó rồi chuẩn hoá ngay tại `toBlocked()` —
 * kiểu công khai bên dưới phải phân biệt được bằng `ok`, nếu không thì mỗi chỗ đọc
 * kết quả lại phải tự đoán và TypeScript không thu hẹp được union.
 */
type GraphBlockedWire = Omit<GraphBlocked, 'ok'> & { ok?: false }

export type GraphRootsResult =
  | { ok: true; roots: InfraGraphRoot[]; notes: string[] }
  | GraphBlocked
  | GraphFailed

export type GraphBuildResult =
  | { ok: true; graph: InfraGraph; command: string }
  | GraphBlocked
  | GraphFailed

type GraphRootsWire =
  | { ok: true; roots: InfraGraphRoot[]; notes: string[] }
  | GraphBlockedWire
  | GraphFailed

type GraphBuildWire =
  | { ok: true; graph: InfraGraph; command: string }
  | GraphBlockedWire
  | GraphFailed

/** `blocked` thô (`ok` vắng mặt) → `ok: false`. Mọi lượt bị chặn đi qua đây. */
function toBlocked(res: GraphBlockedWire): GraphBlocked {
  return { ...res, ok: false }
}

export type GraphRootsParams = {
  context: GraphContext
  sessionId?: string
  messageId?: string
  approvalTicket?: string
}

export type GraphResolveParams = {
  context: GraphContext
  rootId: string
  depth?: number
  sessionId?: string
  messageId?: string
  approvalTicket?: string
}

export type GraphExpandParams = {
  context: GraphContext
  nodeId: string
  sessionId?: string
  messageId?: string
  approvalTicket?: string
}

export function useInfraGraphApi() {
  const sc = useSidecar()

  return {
    roots: async (p: GraphRootsParams): Promise<GraphRootsResult> => {
      const res = await sc.request<GraphRootsWire>('infra.graph-roots', { ...p })
      if (res.ok) return res
      if (res.blocked) return toBlocked(res)
      return res
    },

    resolve: async (p: GraphResolveParams): Promise<GraphBuildResult> => {
      const res = await sc.request<GraphBuildWire>('infra.graph-resolve', { ...p })
      if (res.ok) return res
      if (res.blocked) return toBlocked(res)
      return res
    },

    /**
     * Mở rộng ĐÚNG MỘT node thêm một bước. `graph.nodes` của lượt này chỉ chứa phần
     * MỚI — người gọi phải gộp vào graph đang có, không được thay thế.
     */
    expand: async (p: GraphExpandParams): Promise<GraphBuildResult> => {
      const res = await sc.request<GraphBuildWire>('infra.graph-expand', { ...p })
      if (res.ok) return res
      if (res.blocked) return toBlocked(res)
      return res
    },
  }
}
