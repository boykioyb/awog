// `slack_draft_reply` trên nhánh Claude SDK (docs/features/slack-threads.md).
//
// Một SDK MCP server in-process tên `awogslack` → `mcp__awogslack__slack_draft_reply`.
// Handler là ĐÚNG hàm mà Pi AgentTool gọi (`runSlackDraftReply`), nên "soạn giúp tôi
// câu trả lời" cư xử giống nhau bất kể phiên chạy runtime nào: suy thread từ phiên,
// chỉ phát `slack.draft`, không gửi gì lên Slack.

import { z } from 'zod'
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk'
import {
  MAX_DRAFT_LEN,
  SLACK_DRAFT_TEXT,
  SLACK_DRAFT_TOOL_NAME,
  SLACK_MCP_SERVER,
  runSlackDraftReply,
} from '../tools/slack-tools.js'

export function buildSlackToolsSdkServer(sessionId: string): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: SLACK_MCP_SERVER,
    version: '1.0.0',
    tools: [
      tool(
        SLACK_DRAFT_TOOL_NAME,
        SLACK_DRAFT_TEXT.description,
        // Trần độ dài cũng khai ở schema để hai runtime có cùng lớp phòng thủ đầu;
        // hàng rào thật vẫn là `runSlackDraftReply`.
        { text: z.string().max(MAX_DRAFT_LEN).describe(SLACK_DRAFT_TEXT.text) },
        async (args) => {
          const r = await runSlackDraftReply(sessionId, args.text)
          return {
            content: [{ type: 'text' as const, text: r.text }],
            ...(r.isError ? { isError: true } : {}),
          }
        },
      ),
    ],
  })
}
