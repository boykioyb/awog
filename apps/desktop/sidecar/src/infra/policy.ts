// Ma trận quyền hạ tầng (ADR 0088 §5, §5b) — hàm THUẦN, không I/O.
//
// `classify()` trả về LỚP của lệnh; file này trả lời câu còn lại: lớp đó, trên
// loại tài khoản đó, thì **chạy thẳng · hỏi người · hay chặn**. Tách thuần ra đây
// để cổng quyền (`runtime/permission.ts`), tool của agent và UI cùng đọc một
// nguồn, và để test được bằng bảng mà không cần dựng phiên.
//
// Hai luật nằm ngoài ma trận, đã cứng trong `run.ts`: cờ ghi đè ngữ cảnh và cờ
// đổi điểm cuối bị từ chối ở MỌI mức duyệt.

import type { InfraCommandClass } from './types.js'

/** Ba chế độ mỗi ô. */
export type InfraMode = 'auto' | 'ask' | 'block'

/** Cột của ma trận. `production` là cột siết hơn. */
export type InfraAccountKind = 'normal' | 'production'

export type InfraMatrix = Record<InfraCommandClass, Record<InfraAccountKind, InfraMode>>

/**
 * Mặc định xuất xưởng (ADR 0088 §5). Đọc chạy thẳng; ghi luôn hỏi; phá huỷ hỏi ở
 * tài khoản thường và **chặn** ở production; agent tự đổi ngữ cảnh thì phải hỏi
 * khi đích là production.
 */
export const DEFAULT_MATRIX: InfraMatrix = {
  read: { normal: 'auto', production: 'auto' },
  write: { normal: 'ask', production: 'ask' },
  destructive: { normal: 'ask', production: 'block' },
  'context-switch': { normal: 'auto', production: 'ask' },
}

/** Thứ tự siết dần — dùng để lấy cái chặt hơn giữa hai nguồn. */
const RANK: Record<InfraMode, number> = { auto: 0, ask: 1, block: 2 }

export function strictest(a: InfraMode, b: InfraMode): InfraMode {
  return RANK[a] >= RANK[b] ? a : b
}

export type InfraPolicy = {
  matrix: InfraMatrix
  /** Account id người dùng tự đánh dấu là production (ADR 0088 — theo id, không theo tên profile). */
  prodAccountIds: readonly string[]
  /** Bypass tạm thời còn hiệu lực tới lúc này (ISO). Hết hạn thì tự quay về ma trận. */
  bypassUntil?: string | undefined
}

export type InfraDecisionInput = {
  policy: InfraPolicy
  class: InfraCommandClass
  accountId?: string | undefined
  /**
   * Mức trần mà PHIÊN tự siết xuống (ADR 0088 §5b). Chỉ được làm chặt hơn — nếu
   * nới được thì một phiên bị dẫn dụ có thể tự mở khoá cho chính nó.
   */
  sessionFloor?: InfraMode | undefined
  /**
   * Tên lệnh `read` mà KẾT QUẢ là NỘI DUNG log (`sensitiveReadOf()` trong
   * `classify.ts`), hoặc undefined.
   *
   * Vì sao cần một trục riêng thay vì đổi `DEFAULT_MATRIX.read.production`:
   * ma trận chỉ có hai chiều (lớp × loại tài khoản), nên hạ cả cột `read` của
   * production xuống `ask` sẽ bắt mọi lệnh `describe-*` của Explorer phải hỏi
   * người dùng ở Mốc 3 — trong khi thứ thật sự nguy hiểm chỉ là bốn op trả về
   * NỘI DUNG log. Siết đúng chỗ thì hàng rào mới sống được lâu.
   */
  sensitiveRead?: string | undefined
  now?: number | undefined
}

export type InfraDecisionResult = {
  mode: InfraMode
  /** Vì sao ra mức đó — đi thẳng vào prompt duyệt và vào nhật ký. */
  reason: 'matrix' | 'bypass' | 'session-narrowed' | 'sensitive-read'
  accountKind: InfraAccountKind
  /** Còn bao nhiêu giây bypass, để UI đếm ngược. */
  bypassSecondsLeft?: number
}

export function accountKindOf(
  policy: InfraPolicy,
  accountId: string | undefined,
): InfraAccountKind {
  // ⚠ Vắng `accountId` ⇒ **production** (audit #1 F6), không phải `normal`.
  // `infra.contexts` không biết account id của profile static/assume-role, và UI
  // chỉ ghim được id SAU khi người dùng tự bấm kiểm tra danh tính. Trả `normal`
  // ở trạng thái chưa biết nghĩa là ô `destructive/production = block` — hàng rào
  // mạnh nhất của cả thiết kế — gần như không bao giờ được áp. Đó là fail-open
  // theo mặc định, không phải kịch bản đối thủ. Không biết mình đang ở đâu thì
  // phải coi là đang ở chỗ nguy hiểm nhất.
  if (!accountId) return 'production'
  return policy.prodAccountIds.includes(accountId) ? 'production' : 'normal'
}

/**
 * Quyết định cuối cùng cho một lời gọi.
 *
 * Bypass tạm thời chỉ nâng `ask → auto`; nó **không** gỡ được `block`. Cố ý: van
 * xả cho lúc xử lý sự cố không nên biến thành đường mở cho lệnh phá huỷ trên
 * production — muốn thế thì phải sửa hẳn ô trong ma trận, nơi nhìn thấy được.
 */
export function decide(input: InfraDecisionInput): InfraDecisionResult {
  const kind = accountKindOf(input.policy, input.accountId)
  const base = input.policy.matrix[input.class][kind]
  const now = input.now ?? Date.now()

  let mode = base
  let reason: InfraDecisionResult['reason'] = 'matrix'
  let bypassLeft: number | undefined

  const until = input.policy.bypassUntil ? Date.parse(input.policy.bypassUntil) : NaN
  if (!Number.isNaN(until) && until > now && base === 'ask') {
    mode = 'auto'
    reason = 'bypass'
    bypassLeft = Math.round((until - now) / 1000)
  }

  // Đọc NỘI DUNG log trên production ⇒ luôn phải có người duyệt. Chỉ SIẾT được
  // (không nới), và đứng TRƯỚC `sessionFloor` để trần của phiên vẫn áp lên trên.
  // Bypass tạm thời cũng không gỡ được: van xả lúc chữa cháy không phải đường
  // đưa log production vào context của model mà không ai nhìn.
  if (input.sensitiveRead && kind === 'production' && RANK[mode] < RANK.ask) {
    mode = 'ask'
    reason = 'sensitive-read'
  }

  if (input.sessionFloor) {
    const narrowed = strictest(mode, input.sessionFloor)
    if (narrowed !== mode) {
      mode = narrowed
      reason = 'session-narrowed'
    }
  }

  return {
    mode,
    reason,
    accountKind: kind,
    ...(bypassLeft !== undefined ? { bypassSecondsLeft: bypassLeft } : {}),
  }
}

/** Chính sách rỗng an toàn — dùng khi settings chưa nạp xong hoặc file hỏng. */
export function defaultPolicy(): InfraPolicy {
  return { matrix: DEFAULT_MATRIX, prodAccountIds: [] }
}
