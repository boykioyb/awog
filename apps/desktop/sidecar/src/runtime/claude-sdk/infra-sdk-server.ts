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
  INFRA_ACTION_TOOL_NAME,
  INFRA_CONTEXT_TOOL_NAME,
  INFRA_TOOL_TEXT,
  INFRA_VIEW_TOOL_NAME,
  KUBECTL_CLI_TOOL_NAME,
  LOGS_QUERY_TOOL_NAME,
  LOGS_TAIL_TOOL_NAME,
  TF_CLI_TOOL_NAME,
  runAwsCli,
  runAwsProfiles,
  runInfraAction,
  runInfraContext,
  runInfraView,
  runKubectlCli,
  runLogsQuery,
  runLogsTail,
  runTfCli,
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
        // Hai tool log (Mốc 2 việc 2.9) — cùng luật "chỉ có khi đã ghim profile".
        // Handler KHÔNG chứa logic: gọi lại đúng lõi `runLogsQuery`/`runLogsTail`
        // của nhánh Pi, nên hai runtime không thể lệch luật về cùng một tool.
        tool(
          LOGS_QUERY_TOOL_NAME,
          INFRA_TOOL_TEXT.logsQuery.description,
          {
            logGroups: z.array(z.string()).describe(INFRA_TOOL_TEXT.logsQuery.args),
            query: z.string().describe('CloudWatch Logs Insights query string.'),
            startTime: z
              .union([z.string(), z.number()])
              .describe(INFRA_TOOL_TEXT.logsQuery.startTime),
            endTime: z
              .union([z.string(), z.number()])
              .describe(INFRA_TOOL_TEXT.logsQuery.endTime),
            limit: z.number().optional().describe(INFRA_TOOL_TEXT.logsQuery.limit),
          },
          async (args) =>
            textResult(
              (
                await runLogsQuery(
                  {
                    logGroups: args.logGroups,
                    query: args.query,
                    startTime: args.startTime,
                    endTime: args.endTime,
                    ...(args.limit !== undefined ? { limit: args.limit } : {}),
                  },
                  {
                    context: { ...context, profile },
                    gated: opts.gated === true,
                    agentName: opts.agentName,
                    sessionId: opts.sessionId,
                    messageId: opts.messageId,
                  },
                )
              ).text,
            ),
        ),
        tool(
          LOGS_TAIL_TOOL_NAME,
          INFRA_TOOL_TEXT.logsTail.description,
          {
            logGroups: z.array(z.string()).describe(INFRA_TOOL_TEXT.logsTail.args),
            minutes: z.number().optional().describe(INFRA_TOOL_TEXT.logsTail.minutes),
            filterPattern: z.string().optional().describe(INFRA_TOOL_TEXT.logsTail.filterPattern),
            limit: z.number().optional().describe(INFRA_TOOL_TEXT.logsTail.limit),
          },
          async (args) =>
            textResult(
              (
                await runLogsTail(
                  {
                    logGroups: args.logGroups,
                    ...(args.minutes !== undefined ? { minutes: args.minutes } : {}),
                    ...(args.filterPattern !== undefined
                      ? { filterPattern: args.filterPattern }
                      : {}),
                    ...(args.limit !== undefined ? { limit: args.limit } : {}),
                  },
                  {
                    context: { ...context, profile },
                    gated: opts.gated === true,
                    agentName: opts.agentName,
                    sessionId: opts.sessionId,
                    messageId: opts.messageId,
                  },
                )
              ).text,
            ),
        ),
      ]
    : []

  // Mốc 3 (task 3.10): `infra_view` / `infra_action` cho nhánh Claude SDK. Handler
  // KHÔNG chứa logic — gọi lại đúng lõi `runInfraView`/`runInfraAction` của nhánh
  // Pi, nên hai runtime không thể dạy model hai luật khác nhau về cùng một tool.
  const explorerTools = profile
    ? [
        tool(
          INFRA_VIEW_TOOL_NAME,
          INFRA_TOOL_TEXT.infraView.description,
          {
            view: z.string().describe(INFRA_TOOL_TEXT.infraView.args),
            values: z
              .record(z.string(), z.string())
              .optional()
              .describe('Values the view requires (e.g. { bucket: "my-bucket" }).'),
            token: z.string().optional().describe(INFRA_TOOL_TEXT.infraView.token),
          },
          async (args) =>
            textResult(
              (
                await runInfraView(
                  {
                    view: args.view,
                    ...(args.values !== undefined ? { values: args.values } : {}),
                    ...(args.token !== undefined ? { token: args.token } : {}),
                  },
                  {
                    context: { ...context, profile },
                    gated: opts.gated === true,
                    agentName: opts.agentName,
                    sessionId: opts.sessionId,
                    messageId: opts.messageId,
                  },
                )
              ).text,
            ),
        ),
        tool(
          INFRA_ACTION_TOOL_NAME,
          INFRA_TOOL_TEXT.infraAction.description,
          {
            view: z.string().describe(INFRA_TOOL_TEXT.infraAction.args),
            action: z.string().describe('Action id, e.g. "ec2.stop".'),
            row: z.record(z.string(), z.string()).optional().describe(INFRA_TOOL_TEXT.infraAction.row),
            values: z
              .record(z.string(), z.string())
              .optional()
              .describe(INFRA_TOOL_TEXT.infraAction.values),
          },
          async (args) =>
            textResult(
              (
                await runInfraAction(
                  {
                    view: args.view,
                    action: args.action,
                    ...(args.row !== undefined ? { row: args.row } : {}),
                    ...(args.values !== undefined ? { values: args.values } : {}),
                  },
                  {
                    context: { ...context, profile },
                    gated: opts.gated === true,
                    agentName: opts.agentName,
                    sessionId: opts.sessionId,
                    messageId: opts.messageId,
                  },
                )
              ).text,
            ),
        ),
      ]
    : []

  // Cùng luật "chỉ advertise khi đã ghim" như nhánh Pi (`createInfraTools`):
  // `kubectl_cli` cần `cluster`, `tf_cli` cần `workspace`.
  const kubectlTools = context.cluster
    ? [
        tool(
          KUBECTL_CLI_TOOL_NAME,
          INFRA_TOOL_TEXT.kubectlCli.description,
          { args: z.array(z.string()).describe(INFRA_TOOL_TEXT.kubectlCli.args) },
          async (args) =>
            textResult(
              (
                await runKubectlCli(args.args, {
                  context,
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

  const tfTools = context.workspace
    ? [
        tool(
          TF_CLI_TOOL_NAME,
          INFRA_TOOL_TEXT.tfCli.description,
          { args: z.array(z.string()).describe(INFRA_TOOL_TEXT.tfCli.args) },
          async (args) =>
            textResult(
              (
                await runTfCli(args.args, {
                  context,
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
      ...explorerTools,
      ...kubectlTools,
      ...tfTools,
    ],
  })
}
