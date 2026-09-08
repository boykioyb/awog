// `code_index` trên nhánh Claude SDK (docs/features/code-index.md).
//
// Một in-process SDK MCP server tên `awogcode` → `mcp__awogcode__code_index`. Handler
// là ĐÚNG hàm nhánh Pi gọi (`runCodeIndex`), không phải bản chép: mọi cap kích thước
// (`MAX_TOTAL_CHARS`, `MAX_LISTED_PER_GROUP`) và — quan trọng hơn — mọi lời cảnh báo
// về chỗ mù của parser ("refs không thấy gì" ≠ "không ai gọi") nằm trong hàm đó. Một
// bản dựng lại ở đây sẽ trôi khỏi bản kia im lặng, và một tool giấu giới hạn thì bị
// tin quá mức — ở đây tin quá mức nghĩa là kết luận "không ai dùng" rồi xoá.
//
// Vì sao SERVER RIÊNG, không đi nhờ `awogsurfaces`: tên server hiện ra trong luật
// quyền và trong `disabledTools`, nên nó phải nói đúng tool là gì. `code_index` cùng
// họ với Grep/Glob — một NGUỒN ĐỌC mã nguồn — chứ không phải một thứ model đặt vào
// transcript; gộp chung thì tắt "surfaces" sẽ vô tình tắt luôn khả năng tra mã.
//
// ĐIỀU KIỆN CẤP PHÁT: nhánh Pi cấp tool này VÔ ĐIỀU KIỆN (runtime/tools/index.ts —
// nó chỉ đọc, và chỉ mục được dựng LƯỜI ở lần gọi đầu nên không dùng thì không tốn
// gì), nên ở đây cũng vô điều kiện.

import { z } from 'zod'
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk'
import {
  CODE_INDEX_MCP_SERVER,
  CODE_INDEX_TEXT,
  runCodeIndex,
  type CodeIndexRunParams,
} from '../tools/code-index-tool.js'

export function buildCodeIndexSdkServer(cwd: string): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: CODE_INDEX_MCP_SERVER,
    version: '1.0.0',
    // Schema nhỏ, và nó phải có mặt ĐÚNG lúc câu hỏi là "ai gọi cái này". Hoãn sau
    // tool-search thì model phải đoán rằng một tool như thế tồn tại rồi mới đi tìm —
    // tức nó sẽ Grep, đúng thứ tool này sinh ra để thay.
    alwaysLoad: true,
    tools: [
      tool(
        'code_index',
        CODE_INDEX_TEXT.description,
        {
          action: z.enum(['define', 'refs', 'blast', 'status']).describe(CODE_INDEX_TEXT.action),
          symbol: z.string().optional().describe(CODE_INDEX_TEXT.symbol),
          path: z.string().optional().describe(CODE_INDEX_TEXT.path),
          depth: z.number().optional().describe(CODE_INDEX_TEXT.depth),
        },
        async (args) => {
          const r = await runCodeIndex(cwd, args as CodeIndexRunParams)
          // `isError` qua cầu tường minh: "không index được workspace" hay "blast
          // thiếu path" phải render thành bước LỖI. Lõi báo hỏng bằng
          // `details.isError`, không throw (tools/tool-error.ts).
          return {
            content: [{ type: 'text' as const, text: r.text }],
            ...(r.isError ? { isError: true } : {}),
          }
        },
      ),
    ],
  })
}
