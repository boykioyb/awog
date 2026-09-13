// Nhóm tool hạ tầng (ADR 0088 §4, task 0.12) cho runtime Claude Agent SDK — một
// server MCP in-process khoá `awoginfra`, tức model thấy
// `mcp__awoginfra__aws_cli` / `__aws_profiles` / `__infra_context`.
//
// Vì sao phải có bản này: ADR 0058 chọn runtime THEO PROVIDER, và provider
// `anthropic` (nhánh phổ biến nhất) chạy trên Claude SDK chứ không phải Pi. Chỉ
// dựng AgentTool ở `runtime/tools/infra-tools.ts` là để đúng nhánh đông người
// dùng nhất không có tool hạ tầng nào.
//
// Handler KHÔNG chứa logic: mọi thứ gọi lại lõi `run*` dùng chung ở
// `runtime/tools/infra-tools.ts` — cùng ma trận quyền, cùng ngân sách clamp,
// cùng dòng nhật ký. Mô tả tool cũng lấy từ `INFRA_TOOL_TEXT` để hai runtime
// không dạy model hai luật khác nhau về cùng một tool.

import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import {
  AWS_CLI_TOOL_NAME,
  AWS_PROFILES_TOOL_NAME,
  INFRA_CONTEXT_TOOL_NAME,
  INFRA_TOOL_TEXT,
  runAwsCli,
  runAwsProfiles,
  runInfraContext,
  type CreateInfraToolsOptions,
} from '../tools/infra-tools.js'

function textResult(text: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text }] }
}

/**
 * Dựng server `awoginfra`. `aws_cli` chỉ được đưa vào khi phiên đã ghim profile
 * — cùng luật với nhánh Pi (`createInfraTools`), vì một tool chắc chắn trả lỗi
 * vẫn tốn của model một lượt gọi để phát hiện ra.
 */
export function buildInfraToolsSdkServer(
  opts: CreateInfraToolsOptions,
): McpSdkServerConfigWithInstance {
  const { context } = opts
  const profile = context.profile

  // Mảng 1 phần tử (hoặc rỗng) thay vì `push`: kiểu phần tử của literal `tools`
  // phải bao được cả hai nhánh dưới `exactOptionalPropertyTypes`.
  const cliTools = profile
    ? [
        tool(
          AWS_CLI_TOOL_NAME,
          INFRA_TOOL_TEXT.awsCli.description,
          { args: z.array(z.string()).describe(INFRA_TOOL_TEXT.awsCli.args) },
          async (args) =>
            textResult(
              (
                await runAwsCli(args.args, {
                  context: { ...context, profile },
                  gated: opts.gated === true,
                  agentName: opts.agentName,
                  sessionId: opts.sessionId,
                  messageId: opts.messageId,
                })
              ).text,
            ),
        ),
      ]
    : []

  return createSdkMcpServer({
    name: 'awoginfra',
    version: '1.0.0',
    tools: [
      tool(
        AWS_PROFILES_TOOL_NAME,
        INFRA_TOOL_TEXT.awsProfiles.description,
        {},
        async () => textResult((await runAwsProfiles(context.profile)).text),
      ),
      tool(
        INFRA_CONTEXT_TOOL_NAME,
        INFRA_TOOL_TEXT.infraContext.description,
        {},
        async () => textResult((await runInfraContext(context)).text),
      ),
      ...cliTools,
    ],
  })
}
