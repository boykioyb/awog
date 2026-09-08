// Một source KHÔNG được mang id trùng tên server MCP in-process của AWOG.
//
// Trên nhánh Claude SDK (`runtime/claude-sdk/run-stream.ts`) các server của AWOG
// — `awogterm`, `awogwiki`, `awog`, … — được gộp SAU CÙNG vào
// `options.mcpServers`, mà khoá của một server ngoài chính là source id. Trùng
// khoá ⇒ AWOG thắng ⇒ mọi tool của source đó biến mất, không một dòng cảnh báo.
// Người dùng thấy source "đã kết nối" mà model không gọi được gì.
//
// Đây là hàng rào FAIL-CLOSED ở biên TẠO/SỬA: từ chối kèm lý do đọc được, chứ
// không tự đổi tên hộ (đường DI TRÚ mới đổi tên — ở đó không có ai để hỏi, xem
// `sources/migrate.ts`). Cố ý KHÔNG đặt trong `SourceConfigSchema`: schema còn là
// đường ĐỌC, và một config đã nằm trên đĩa từ trước mà bị schema loại thì source
// biến mất khỏi danh sách — tệ hơn hẳn việc nó hiện ra kèm cảnh báo trong log.
//
// Danh sách tên đến TỪ `runtime/tools/bridged.ts` (nguồn duy nhất), không chép tay.

import { isReservedAwogServerName } from '../runtime/tools/bridged.js'

// Trả về thông điệp lỗi khi `id` trùng tên dành riêng, `null` khi hợp lệ. Trả
// message thay vì throw để cả hai chỗ gọi dùng chung được: RPC bọc thành
// RpcError, tool của model trả về như một kết quả lỗi đọc được.
export function reservedSourceIdError(id: string): string | null {
  if (!isReservedAwogServerName(id)) return null
  return `source id "${id}" is reserved by an AWOG built-in MCP server — a source with this id loses every one of its tools on the Anthropic runtime (AWOG's server of the same name wins). Pick a different id.`
}
