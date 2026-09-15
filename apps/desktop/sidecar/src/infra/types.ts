// Kiểu dùng chung của module hạ tầng (AWS · Terraform · kubectl) — ADR 0088.
//
// Giữ ở đây đúng những gì mốc 0.1/0.2 cần: tên công cụ, bốn lớp lệnh, và kết quả
// dò binary. Ngữ cảnh phiên (profile/region/workspace/context) và kiểu kết quả
// `infra.run` thuộc các task sau, cố tình CHƯA khai ở đây để không đặt trước chữ
// ký cho code chưa viết (YAGNI).

/** Ba CLI mà AWOG gọi trực tiếp bằng arg array (ADR 0088 §3). */
export type InfraTool = 'aws' | 'terraform' | 'kubectl'

export const INFRA_TOOLS: readonly InfraTool[] = ['aws', 'terraform', 'kubectl']

/**
 * Bốn LỚP lệnh — không phải bốn mức quyền (ADR 0088 §5). Quyền là kết quả của
 * ma trận cài đặt áp lên lớp này, nên `classify()` chỉ trả lớp và không bao giờ
 * tự kết luận cho phép hay không.
 *
 * `context-switch` KHÔNG suy được từ argv: nó mô tả lời gọi đổi ngữ cảnh nội bộ
 * của AWOG (tool `infra_context`), xem `CONTEXT_SWITCH_CLASS` trong classify.ts.
 */
export type InfraCommandClass = 'read' | 'write' | 'destructive' | 'context-switch'

/** Một dòng trong `infra.status`: công cụ này có trên máy không, bản nào. */
export type InfraBinaryStatus = {
  tool: InfraTool
  found: boolean
  /** Realpath đã verify, hoặc null khi không tìm thấy binary hợp lệ. */
  path: string | null
  /** Dòng đầu của `--version`, hoặc null khi không dò được. */
  version: string | null
  /** Gợi ý cài đặt, chỉ có khi `found === false`. */
  hint: string | null
  /**
   * Realpath của một bản cài CÓ THẬT nhưng nằm ngoài allowlist prefix (task 0.1b).
   * UI mời người dùng bảo lãnh đúng đường dẫn này; `null` khi không có gì để bảo
   * lãnh (chưa cài, hoặc bản cài đã nằm trong allowlist).
   */
  rejectedPath: string | null
}
