// `list_sessions` + `send_session_message` trên nhánh Claude SDK (gói #17).
//
// Một in-process SDK MCP server tên `awogsessions` → `mcp__awogsessions__list_sessions`
// và `mcp__awogsessions__send_session_message`. Handler là ĐÚNG hàm nhánh Pi gọi
// (`createSessionMessagingRunners`), không phải bản chép: trần theo lượt, hàng rào
// mang nonce quanh danh bạ (tiêu đề phiên khác là dữ liệu L1 với phiên đang hỏi), và
// việc dịch `InboxError` thành một câu từ chối có lý do đều nằm trong đó.
//
// Bộ đếm `sentThisTurn` sống trong closure của runner, và server này được dựng MỘT
// LẦN MỖI LƯỢT trong `runStreamClaude` — nên trần "N tin mỗi lượt" ở đây có đúng
// nghĩa như bên Pi, không phải trần theo cả phiên.
//
// Vì sao SERVER RIÊNG, không đi nhờ `awogsurfaces`: tên server hiện ra trong luật
// quyền và trong `disabledTools`, nên nó phải nói đúng tool là gì. Một surface đặt
// một thẻ vào transcript của CHÍNH phiên này, cho người dùng của chính nó; hai tool
// ở đây thì đọc danh bạ các phiên khác và GHI vào hộp thư của một phiên khác — một
// biên tin cậy khác hẳn, và một cú tắt "surfaces" không được phép vô tình khoá nó.
//
// ĐIỀU KIỆN CẤP PHÁT: nhánh Pi gate hai tool này bằng `filter.chatSession`. File
// run-stream.ts CHÍNH LÀ đường chat, nên ở đó chúng được cấp vô điều kiện.

import { z } from 'zod'
import { MAX_TEXT_LEN } from '../../sessions/inbox.js'
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk'
import {
  SESSION_MESSAGING_MCP_SERVER,
  SESSION_MESSAGING_TEXT,
  createSessionMessagingRunners,
} from '../tools/session-tools.js'

export function buildSessionMessagingSdkServer(sessionId: string): McpSdkServerConfigWithInstance {
  const run = createSessionMessagingRunners({ sessionId })

  return createSdkMcpServer({
    name: SESSION_MESSAGING_MCP_SERVER,
    version: '1.0.0',
    // CỐ Ý không `alwaysLoad`: để tool-search của CLI hoãn hai schema này tới khi
    // cần. Khác `code_index` / `dev_server` — hai tool đó phải nạp thẳng vì model
    // KHÔNG BIẾT chúng tồn tại thì nó im lặng rơi về một cách làm tệ hơn (Grep,
    // đoán lệnh dev). Ở đây thì ngược lại: nhu cầu luôn do người dùng nói ra
    // ("báo cho phiên kia biết…"), nên ý định có trước và tool-search nhặt được.
    tools: [
      tool('list_sessions', SESSION_MESSAGING_TEXT.listDescription, {}, async () => {
        const r = await run.listSessions()
        return { content: [{ type: 'text' as const, text: r.text }] }
      }),
      tool(
        'send_session_message',
        SESSION_MESSAGING_TEXT.sendDescription,
        {
          session_id: z.string().describe(SESSION_MESSAGING_TEXT.sessionId),
          // Cùng lý do với `note` của schedule_wakeup: hàng rào thật là
          // `postSessionMessage` (kiểm `MAX_TEXT_LEN`), nhưng lớp phòng thủ đầu
          // tiên phải giống nhau ở hai runtime.
          message: z.string().max(MAX_TEXT_LEN).describe(SESSION_MESSAGING_TEXT.message),
        },
        async (args) => {
          const r = await run.sendSessionMessage(args.session_id, args.message)
          // `isError` qua cầu tường minh: một lần gửi bị từ chối (đích lạ, đã lưu
          // trữ, chạm trần, phát hiện vòng lặp) là một bước LỖI, không phải một cú
          // gửi coi như thành công. Lõi báo hỏng bằng cờ trong kết quả, không throw.
          return {
            content: [{ type: 'text' as const, text: r.text }],
            ...(r.isError ? { isError: true } : {}),
          }
        },
      ),
    ],
  })
}
