// Bảng DUY NHẤT: tool AWOG in-process nào được bắc cầu qua server MCP nào trên
// nhánh Claude SDK.
//
// Vì sao cần một bảng thay vì để mỗi chỗ tự biết: cùng một tool mang HAI tên tuỳ
// runtime — `wiki_read` trên nhánh Pi, `mcp__awogwiki__wiki_read` trên nhánh Claude
// SDK (ADR 0058 chọn runtime theo provider). Mỗi chỗ so tên bằng chuỗi trần là một
// chỗ có thể im lặng bỏ sót ở đúng nhánh phổ biến nhất. Lớp bug này đã xảy ra THẬT
// năm lần: cổng quyền của `browser_tool`, nhãn+icon transcript, công tắc bật/tắt
// tool ở Session config, và `allowedTools` của AGENT.md.
//
// Hai hướng dùng, ngược chiều nhau:
//   - GẤP tên (`mcp__<server>__<tool>` → `<tool>`) để hiển thị: sessions/step-mapper.ts
//   - NỞ tên (`<tool>` → thêm `mcp__<server>__<tool>`) để lọc quyền: allowedTools /
//     disabledTools truyền sang SDK
//
// File này KHÔNG import gì từ `claude-sdk/` và không được phép: `step-mapper.ts`
// dùng nó và chạy trên CẢ HAI nhánh, nên một import như thế sẽ kéo
// `@anthropic-ai/claude-agent-sdk` vào cả đường Pi.

import { SURFACE_MCP_SERVER, SURFACE_TOOL_NAMES } from './surface-tools.js'
import { READ_TERMINAL_TOOL_NAMES, TERMINAL_MCP_SERVER } from './read-terminal-tool.js'
import { BROWSER_MCP_SERVER, BROWSER_TOOL_NAME } from './browser-tool.js'
import { DEV_SERVER_MCP_SERVER, DEV_SERVER_TOOL_NAMES } from './dev-server-tool.js'
import { CODE_INDEX_MCP_SERVER, CODE_INDEX_TOOL_NAMES } from './code-index-tool.js'
import { SESSION_MESSAGING_MCP_SERVER, SESSION_MESSAGING_TOOL_NAMES } from './session-tools.js'

// Nguồn: DẪN XUẤT từ chính các hằng danh sách tool mà mỗi server export, chứ
// không chép tay tên tool. Thêm một tool vào `SURFACE_TOOL_NAMES` là bảng này tự
// biết — chép tay thì sáu tuần sau nó lệch mà không ai hay.
//
// Bốn server cũ (wiki/memory/ssh/sources) chưa có hằng danh sách tương ứng nên
// còn khai tay; ai thêm hằng cho chúng thì chuyển lên nhánh dẫn xuất.
const BRIDGED_SERVERS: readonly (readonly [string, readonly string[]])[] = [
  [SURFACE_MCP_SERVER, SURFACE_TOOL_NAMES],
  [TERMINAL_MCP_SERVER, READ_TERMINAL_TOOL_NAMES],
  [BROWSER_MCP_SERVER, [BROWSER_TOOL_NAME]],
  [DEV_SERVER_MCP_SERVER, DEV_SERVER_TOOL_NAMES],
  [CODE_INDEX_MCP_SERVER, CODE_INDEX_TOOL_NAMES],
  [SESSION_MESSAGING_MCP_SERVER, SESSION_MESSAGING_TOOL_NAMES],
  ['awogwiki', ['wiki_search', 'wiki_read', 'wiki_write', 'wiki_delete']],
  ['awogmemory', ['memory_remember', 'memory_forget', 'memory_read']],
  [
    'awogssh',
    // Luật quyền cho nhóm này đã được đối chiếu thêm ở tầng cổng (`sshToolName`),
    // nhưng `allowedTools` thì không — nên chúng vẫn phải có mặt ở đây.
    [
      'ssh_terminal_run',
      'ssh_exec',
      'ssh_list_hosts',
      'ssh_list_dir',
      'ssh_read_file',
      'ssh_write_file',
    ],
  ],
  // Server tên trần `awog` (không hậu tố), đúng như nó được đăng ký.
  ['awog', ['source_list', 'source_create', 'source_test', 'source_oauth_trigger']],
]

export const AWOG_BRIDGE_SERVER_OF: Readonly<Record<string, string>> = Object.fromEntries(
  BRIDGED_SERVERS.flatMap(([server, names]) => names.map((n) => [n, server] as const)),
)

// Tên server MCP mà AWOG chiếm dụng trên nhánh Claude SDK — DẪN XUẤT từ bảng
// trên, nên thêm một server vào `BRIDGED_SERVERS` là danh sách này tự dài ra.
//
// Vì sao phải công khai: ở `runtime/claude-sdk/run-stream.ts` các server của AWOG
// được gộp SAU CÙNG vào `options.mcpServers`, mà khoá của một server ngoài chính
// là SOURCE ID. Một source mang đúng một trong các tên này bị ghi đè sạch — người
// dùng thấy source "đã kết nối" mà model không có lấy một tool nào của nó. Biên
// tạo source dùng danh sách này để từ chối trước (`sources/reserved.ts`), và
// migration dùng nó để đổi tên một id MCP di trú thay vì để nó xung đột im lặng.
export const AWOG_RESERVED_MCP_SERVER_NAMES: readonly string[] = [
  ...new Set(BRIDGED_SERVERS.map(([server]) => server)),
]

const RESERVED_SERVER_NAMES = new Set(AWOG_RESERVED_MCP_SERVER_NAMES)

export function isReservedAwogServerName(name: string): boolean {
  return RESERVED_SERVER_NAMES.has(name)
}

export function bridgedNameOf(toolName: string): string | null {
  const server = AWOG_BRIDGE_SERVER_OF[toolName]
  return server ? `mcp__${server}__${toolName}` : null
}

// Gấp `mcp__<server>__<tool>` về tên trần. Hậu tố phải là tool CỦA TA dưới đúng
// server CỦA TA: một MCP server của người khác tình cờ tên `awogwiki` vẫn hiện như
// một hàng MCP bình thường, không được mượn nhãn của AWOG.
export function unbridgeAwogToolName(name: string): string {
  if (!name.startsWith('mcp__')) return name
  const rest = name.slice('mcp__'.length)
  const sep = rest.indexOf('__')
  if (sep <= 0) return name
  const server = rest.slice(0, sep)
  const bare = rest.slice(sep + 2)
  return AWOG_BRIDGE_SERVER_OF[bare] === server ? bare : name
}

// Nở một danh sách tên tool để nó khớp trên CẢ HAI nhánh.
//
// Dùng cho `allowedTools` (whitelist `tools:` của AGENT.md) và `disabledTools`
// trước khi truyền sang SDK. Không có bước này, `tools: [Read, wiki_read]` mất
// `wiki_read` trên nhánh Anthropic — cùng một agent, cùng một file cấu hình, khác
// provider. Giữ nguyên tên gốc chứ không thay thế: người dùng có thể đã viết sẵn
// dạng bắc cầu, và luật/whitelist phải khớp cả hai cách viết.
// Nhận `readonly string[]` chứ KHÔNG nhận `undefined`: chỗ gọi đã có guard
// `args.allowedTools ? … : {}`, và giữ nó ở đó là cách kiểu bảo đảm bất biến quan
// trọng nhất — `allowedTools` KHÔNG được biến từ "không đặt" (cho hết) thành "đặt
// rỗng" (cấm hết). Một hàm nhận undefined rồi trả undefined làm bất biến đó thành
// một nhánh runtime ai cũng sửa nhầm được.
export function withBridgedAliases(names: readonly string[]): string[] {
  if (names.length === 0) return []
  const out = new Set<string>(names)
  for (const n of names) {
    const bridged = bridgedNameOf(n)
    if (bridged) out.add(bridged)
  }
  return [...out]
}
