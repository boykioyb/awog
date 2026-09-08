// `read_terminal` trên nhánh Claude SDK.
//
// Một in-process SDK MCP server tên `awogterm` → `mcp__awogterm__read_terminal`.
// Handler là ĐÚNG hàm nhánh Pi gọi (`runReadTerminal`), không phải bản chép: hai
// hàng rào bảo mật của tool này — khử bí mật trước khi gửi đi, và hàng rào mang
// nonce chống prompt injection — nằm trong hàm đó. Một bản dựng lại ở đây sẽ trôi
// khỏi bản kia một cách im lặng, và cái trôi đi là bảo mật chứ không phải văn bản.
//
// Vì sao KHÔNG đi nhờ `awogsurfaces` như `schedule_wakeup`: tên server hiện ra
// trong luật quyền và trong `disabledTools`, nên nó phải nói đúng tool là gì. Một
// wake-up là thứ model đặt vào phiên (cùng họ với các surface khác); đọc terminal
// của người dùng thì không — nó là một nguồn ĐỌC, và gộp nhầm họ ở đây sẽ khiến
// một luật viết cho `mcp__awogsurfaces__*` vô tình phủ luôn nó.
//
// Cấp vô điều kiện ở file này vì file này CHÍNH LÀ đường chat, đúng điều kiện
// `filter.chatSession` mà nhánh Pi dùng (runtime/tools/index.ts): một task hay
// subagent không có người dùng nào đang gõ vào terminal.

import { z } from 'zod'
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk'
import {
  READ_TERMINAL_TEXT,
  TERMINAL_MCP_SERVER,
  runReadTerminal,
} from '../tools/read-terminal-tool.js'

export function buildTerminalToolsSdkServer(cwd: string): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: TERMINAL_MCP_SERVER,
    version: '1.0.0',
    // Một schema nhỏ, và nó phải có mặt ĐÚNG lúc người dùng nói "nhìn cái lỗi
    // trong terminal của tôi đi". Hoãn sau tool-search thì model phải đoán rằng
    // có một tool như thế tồn tại rồi mới đi tìm — tức tính năng được quảng cáo
    // mà không bao giờ dùng tới.
    alwaysLoad: true,
    tools: [
      tool(
        'read_terminal',
        READ_TERMINAL_TEXT.description,
        {
          terminalId: z.string().optional().describe(READ_TERMINAL_TEXT.terminalId),
          lines: z.number().optional().describe(READ_TERMINAL_TEXT.lines),
        },
        async (args) => {
          const r = runReadTerminal(cwd, args)
          // `isError` phải đi qua cầu: "không có terminal nào để đọc" là một yêu
          // cầu KHÔNG thực hiện được, không phải một bước thành công. Nhánh Pi
          // phân biệt bằng `details.isError`; ở đây chỉ có cờ này.
          return {
            content: [{ type: 'text' as const, text: r.text }],
            ...(r.isError ? { isError: true } : {}),
          }
        },
      ),
    ],
  })
}
