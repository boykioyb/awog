// Rút id lần theo được từ MỘT dòng log (L5 — đường vào "lần theo request này").
//
// VÌ SAO Ở UTIL CHỨ KHÔNG Ở COMPONENT: hai chỗ cần nó (nút trên bảng kết quả và
// nút trên bảng tail), và nó là hàm thuần — không state, không IPC.
//
// LUẬT: THÀ KHÔNG CÓ NÚT CÒN HƠN CÓ NÚT DÁN SAI ID. Không tìm thấy gì ⇒ `null` ⇒
// UI ẩn nút, và người dùng vẫn dán tay được ở ô id. Lấy bừa một chuỗi trông giống
// id sẽ chạy một truy vấn tốn tiền cho một thứ không phải request của họ.

/** X-Ray trace id trong một dòng log: `1-<8 hex>-<24 hex>`. */
const XRAY_IN_TEXT = /\b1-[0-9a-f]{8}-[0-9a-f]{24}\b/

/** UUID (request id của Lambda/API Gateway) trong một dòng log. */
const UUID_IN_TEXT = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i

/**
 * Id lần theo được của một dòng, hoặc `null`.
 *
 * Thứ tự ưu tiên có lý do: `@requestId` là trường CHÍNH THỨC của Insights cho dòng
 * Lambda nên nó chắc chắn đúng; X-Ray id đứng trên UUID vì nó mở được nhánh có
 * timing thật; UUID trong `@message` là phương án cuối vì một dòng log có thể chứa
 * UUID của thứ khác (id đơn hàng, id người dùng) — nhưng lúc đó người dùng vẫn
 * thấy id trên nút trước khi bấm.
 */
export function traceIdFromRow(row: Record<string, string>): string | null {
  const requestId = row['@requestId']?.trim()
  if (requestId) return requestId

  const message = row['@message'] ?? ''
  return XRAY_IN_TEXT.exec(message)?.[0] ?? UUID_IN_TEXT.exec(message)?.[0] ?? null
}
