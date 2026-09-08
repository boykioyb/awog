// `dev_server` trên nhánh Claude SDK (docs/features/dev-server.md).
//
// Một in-process SDK MCP server tên `awogdev` → `mcp__awogdev__dev_server`. Handler
// là ĐÚNG hàm nhánh Pi gọi (`runDevServer`), không phải bản chép: việc khử bí mật
// trong log server, hàng rào mang nonce chống prompt injection, và giao kèo "start
// KHÔNG spawn, nó trả về nguyên văn lệnh để model chạy qua `Bash`" nằm trọn trong
// hàm đó. Dựng lại ở đây thì bản này trôi khỏi bản kia một cách im lặng, và cái
// trôi đi là hàng rào chứ không phải văn bản.
//
// Vì sao SERVER RIÊNG, không đi nhờ `awogsurfaces` như `schedule_wakeup`: tên server
// hiện ra trong luật quyền và trong `disabledTools`, nên nó phải nói đúng tool là gì.
// Một surface là thứ model ĐẶT VÀO transcript cho người dùng đọc; `dev_server` thì
// ĐỌC log L1 của một tiến trình và DỪNG được tiến trình đó — gộp chung thì một luật
// viết cho `mcp__awogsurfaces__*` vô tình phủ luôn cả hai việc đó.
//
// ĐIỀU KIỆN CẤP PHÁT: nhánh Pi gate tool này bằng `filter.backgroundExec`, tức
// `!inPlanMode && sessionId` (runtime/run-stream.ts) — KHÔNG phải `chatSession`.
// run-stream.ts của nhánh này giữ đúng điều kiện đó thay vì cấp vô điều kiện: nới
// rộng sang plan mode sẽ là một thay đổi hành vi, và nếu muốn thì phải đổi ở nhánh
// Pi trước để hai runtime không lệch nhau.

import { z } from 'zod'
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk'
import {
  DEV_SERVER_MCP_SERVER,
  DEV_SERVER_TEXT,
  runDevServer,
  type DevServerRunParams,
} from '../tools/dev-server-tool.js'

export function buildDevServerSdkServer(
  projectRoot: string,
  sessionId: string,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: DEV_SERVER_MCP_SERVER,
    version: '1.0.0',
    // Schema nhỏ (5 tham số), và hoãn nó sau tool-search có một cái giá riêng:
    // model KHÔNG BIẾT dự án khai sẵn dev server thì nó sẽ không đi tìm — nó đoán
    // `npm run dev`, đoán sai thư mục, và bật trùng cái đang chạy. Đây đúng lớp
    // "quảng cáo mà không bao giờ dùng tới" mà `read_terminal` cũng bật cờ này để
    // tránh. Ở nhánh Pi tool này luôn có mặt trong toolset, nên đây cũng là hướng
    // gần parity hơn.
    alwaysLoad: true,
    tools: [
      tool(
        'dev_server',
        DEV_SERVER_TEXT.description,
        {
          action: z.enum(['list', 'start', 'logs', 'stop']).describe(DEV_SERVER_TEXT.action),
          name: z.string().optional().describe(DEV_SERVER_TEXT.name),
          lines: z.number().optional().describe(DEV_SERVER_TEXT.lines),
          contains: z.string().optional().describe(DEV_SERVER_TEXT.contains),
          level: z.enum(['all', 'warn', 'error']).optional().describe(DEV_SERVER_TEXT.level),
        },
        async (args) => {
          const r = await runDevServer(projectRoot, sessionId, args as DevServerRunParams)
          // `isError` phải đi qua cầu tường minh: "server đó không tồn tại" hay
          // "lệnh trong bản khai đã đổi" là một yêu cầu KHÔNG thực hiện được, không
          // phải một bước xanh. Lõi báo hỏng bằng `details.isError` (không throw).
          return {
            content: [{ type: 'text' as const, text: r.text }],
            ...(r.isError ? { isError: true } : {}),
          }
        },
      ),
    ],
  })
}
