// Logtime tools trên nhánh Claude SDK (ADR 0091).
//
// Một SDK MCP server in-process tên `awoglogtime` → SDK phơi ra
// `mcp__awoglogtime__logtime_*`. Handler là ĐÚNG những hàm mà Pi AgentTool gọi,
// nên "khai hộ tôi 2 tiếng" cư xử giống nhau bất kể phiên đang chạy runtime nào.

import { z } from 'zod'
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk'
import {
  runLogtimeAdd,
  runLogtimeDay,
  runLogtimeProjects,
  runLogtimeRemove,
} from '../tools/logtime-tools.js'

const textResult = (
  text: string,
  isError = false,
): { content: { type: 'text'; text: string }[]; isError?: boolean } => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true } : {}),
})

export function buildLogtimeToolsSdkServer(opts: {
  canWrite: boolean
}): McpSdkServerConfigWithInstance {
  const readTools = [
    tool(
      'logtime_day',
      'Xem giờ công của một ngày: tổng đã khai / mức ngày, và từng dòng kèm trạng thái (nháp | đã đẩy | đã khoá).',
      { date: z.string().optional().describe('YYYY-MM-DD. Bỏ trống = hôm nay.') },
      async (args) => textResult((await runLogtimeDay(args.date)).text),
    ),
    tool(
      'logtime_projects',
      'Liệt kê dự án đã nối với PMS (tên dùng được cho logtime_add) kèm mức giờ/ngày và bậc làm tròn.',
      {},
      async () => textResult((await runLogtimeProjects()).text),
    ),
  ]

  // Đẩy lên PMS CỐ Ý không có tool (ADR 0091 D-5) — người dùng tự bấm.
  const writeTools = opts.canWrite
    ? [
        tool(
          'logtime_add',
          'Thêm một dòng công NHÁP vào một ngày. Chỉ nằm trong AWOG: tool này KHÔNG đẩy lên PMS. ' +
            'Trần giờ mỗi ngày được cưỡng chế — vượt thì dòng bị cắt cho vừa và kết quả nói rõ.',
          {
            project: z.string().describe('Tên dự án như người dùng thấy, hoặc projectKey.'),
            note: z.string().describe('Một câu mô tả việc đã làm — đúng chữ sẽ hiện trên PMS.'),
            hours: z.number().describe('Số giờ, 0.25–24.'),
            date: z.string().optional().describe('YYYY-MM-DD. Bỏ trống = hôm nay.'),
            issue: z.number().optional().describe('Số issue GitHub để tự gắn task.'),
          },
          async (args) => {
            const r = await runLogtimeAdd(args)
            return textResult(r.text, r.isError)
          },
        ),
        tool(
          'logtime_remove',
          'Xoá một dòng công NHÁP theo id. Dòng đã đẩy lên PMS không xoá được bằng tool này.',
          {
            entryId: z.string().describe('id của dòng (lấy từ logtime_day).'),
            date: z.string().optional().describe('YYYY-MM-DD. Bỏ trống = hôm nay.'),
          },
          async (args) => {
            const r = await runLogtimeRemove(args)
            return textResult(r.text, r.isError)
          },
        ),
      ]
    : []

  return createSdkMcpServer({
    name: 'awoglogtime',
    version: '1.0.0',
    tools: [...readTools, ...writeTools],
  })
}
