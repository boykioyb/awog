// Các tool Ê-KÍP của session team trên nhánh Claude SDK — một in-process MCP
// server tên `awogteam` → `mcp__awogteam__team_item_list` v.v.
//
// Handler là ĐÚNG runner nhánh Pi gọi (`createBoardRunners` /
// `createChannelRunners` / `createMemberRunners`), không phải bản chép: luật
// done/cancelled-là-của-người-dùng, wake assignee/lead, system comment
// transition, và câu từ chối có lý do đều nằm trong runner — một bản chép tay
// sẽ trôi khỏi bản gốc một cách im lặng.
//
// ĐIỀU KIỆN CẤP PHÁT giống hệt nhánh Pi (`filter.chatSession` + membership):
// file run-stream.ts CHÍNH LÀ đường chat nên server được dựng mỗi lượt, nhưng
// factory trả `null` khi phiên không nằm trong nhóm — phiên lẻ không có schema
// `mcp__awogteam__*` nào, y hệt `createBoardTools` trả [] bên kia. Board cần
// thêm PROJECT (board là theo project); channel/member chỉ cần runId.
//
// Vì sao server RIÊNG thay vì gộp `awogsessions`: tên server hiện trong luật
// quyền và `disabledTools`. Tool nhắn-tin-liên-phiên và tool ê-kíp là hai mặt
// của cùng một đội hình nhưng một cú tắt "sessions" không được phép vô tình
// khoá luôn board/channel của ê-kíp — và ngược lại.

import { z } from 'zod'
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk'
import {
  BOARD_TOOLS_TEXT,
  TEAM_MCP_SERVER,
  createBoardRunners,
} from '../tools/board-tools.js'
import {
  CHANNEL_TOOLS_TEXT,
  createChannelRunners,
  resolveRunRoot,
} from '../tools/channel-tools.js'
import { MEMBER_TOOLS_TEXT, createMemberRunners } from '../tools/member-tools.js'
import { BOARD_STATUS_ORDER } from '../../boards/store.js'
import type { BoardItemStatus } from '../../types/shared.js'

// `z.enum` đòi một tuple non-empty; cast hẹp về `BoardItemStatus` (không phải
// `string`) để output của schema map thẳng sang input type của runner.
const statusZod = () =>
  z.enum(BOARD_STATUS_ORDER as [BoardItemStatus, ...BoardItemStatus[]])

type McpText = { content: { type: 'text'; text: string }[]; isError?: boolean }
const mcpResult = (r: { text: string; isError?: boolean }): McpText => ({
  content: [{ type: 'text' as const, text: r.text }],
  ...(r.isError ? { isError: true } : {}),
})

// Trả `null` khi phiên không thuộc nhóm nào — run-stream khi đó không đăng ký
// server này vào mcpServers (phiên lẻ không trả một token schema nào, đúng
// nghĩa `createBoardTools`/`createChannelTools`/`createMemberTools` trả []).
export function buildTeamSdkServer(sessionId: string): McpSdkServerConfigWithInstance | null {
  const board = createBoardRunners({ sessionId })
  // Board đã tự resolve (projectId + runId); channel/member cùng dùng một
  // resolver runId — nhóm không-project vẫn có kênh và member_diff.
  const runId = resolveRunRoot(sessionId)
  const channel = createChannelRunners({ sessionId, runId })
  const member = createMemberRunners({ sessionId, runId })
  if (!board && !channel && !member) return null

  return createSdkMcpServer({
    name: TEAM_MCP_SERVER,
    version: '1.0.0',
    tools: [
      // Nhóm không có project ⇒ board = null ⇒ KHÔNG bung các tool team_item_*
      // (tương đương createBoardTools trả [] bên nhánh Pi).
      ...(board
        ? [
            tool(
              'team_item_list',
              BOARD_TOOLS_TEXT.listDescription,
              {
                status: statusZod().optional().describe(BOARD_TOOLS_TEXT.listStatus),
              },
              async (args) => mcpResult(await board.listItems(args)),
            ),
            tool(
              'team_item_get',
              BOARD_TOOLS_TEXT.getDescription,
              { item_id: z.string().describe(BOARD_TOOLS_TEXT.getItemId) },
              async (args) => mcpResult(await board.getItem(args)),
            ),
            tool(
              'team_item_create',
              BOARD_TOOLS_TEXT.createDescription,
              {
                title: z.string().describe(BOARD_TOOLS_TEXT.createTitle),
                desc: z.string().optional().describe(BOARD_TOOLS_TEXT.createDesc),
                assignee_session_id: z
                  .string()
                  .optional()
                  .describe(BOARD_TOOLS_TEXT.createAssignee),
                assignee_member: z
                  .string()
                  .optional()
                  .describe(BOARD_TOOLS_TEXT.createAssigneeMember),
                member_instance: z
                  .number()
                  .int()
                  .min(2)
                  .optional()
                  .describe(BOARD_TOOLS_TEXT.memberInstance),
                stage: z.number().int().optional().describe(BOARD_TOOLS_TEXT.createStage),
                status: z
                  .enum(['backlog', 'todo'])
                  .optional()
                  .describe(BOARD_TOOLS_TEXT.createStatus),
                type: z
                  .enum(['epic', 'story', 'task', 'subtask', 'bug'])
                  .optional()
                  .describe(BOARD_TOOLS_TEXT.createType),
                parent_id: z.string().optional().describe(BOARD_TOOLS_TEXT.createParent),
                priority: z
                  .enum(['urgent', 'high', 'medium', 'low'])
                  .optional()
                  .describe(BOARD_TOOLS_TEXT.createPriority),
                severity: z
                  .enum(['blocker', 'major', 'minor', 'trivial'])
                  .optional()
                  .describe(BOARD_TOOLS_TEXT.createSeverity),
              },
              async (args) => mcpResult(await board.createItem(args)),
            ),
            tool(
              'team_item_update',
              BOARD_TOOLS_TEXT.updateDescription,
              {
                item_id: z.string().describe(BOARD_TOOLS_TEXT.updateItemId),
                // Có cả done/cancelled trong schema — lỗi chính sách của runner
                // giải thích đúng hơn một lỗi validate union (cùng lý do Pi).
                status: statusZod().optional().describe(BOARD_TOOLS_TEXT.updateStatus),
                assignee_session_id: z
                  .string()
                  .nullable()
                  .optional()
                  .describe(BOARD_TOOLS_TEXT.updateAssignee),
                assignee_member: z
                  .string()
                  .optional()
                  .describe(BOARD_TOOLS_TEXT.updateAssigneeMember),
                member_instance: z
                  .number()
                  .int()
                  .min(2)
                  .optional()
                  .describe(BOARD_TOOLS_TEXT.memberInstance),
                stage: z
                  .number()
                  .int()
                  .nullable()
                  .optional()
                  .describe(BOARD_TOOLS_TEXT.updateStage),
                title: z.string().optional().describe(BOARD_TOOLS_TEXT.updateTitle),
                desc: z.string().optional().describe(BOARD_TOOLS_TEXT.updateDesc),
                type: z
                  .enum(['epic', 'story', 'task', 'subtask', 'bug'])
                  .optional()
                  .describe(BOARD_TOOLS_TEXT.updateType),
                parent_id: z
                  .string()
                  .nullable()
                  .optional()
                  .describe(BOARD_TOOLS_TEXT.updateParent),
                priority: z
                  .enum(['urgent', 'high', 'medium', 'low'])
                  .optional()
                  .describe(BOARD_TOOLS_TEXT.updatePriority),
                severity: z
                  .enum(['blocker', 'major', 'minor', 'trivial'])
                  .optional()
                  .describe(BOARD_TOOLS_TEXT.updateSeverity),
              },
              async (args) => mcpResult(await board.updateItem(args)),
            ),
            tool(
              'team_item_comment',
              BOARD_TOOLS_TEXT.commentDescription,
              {
                item_id: z.string().describe(BOARD_TOOLS_TEXT.commentItemId),
                text: z.string().max(4000).describe(BOARD_TOOLS_TEXT.commentText),
              },
              async (args) => mcpResult(await board.commentItem(args)),
            ),
          ]
        : []),
      ...(channel
        ? [
            tool(
              'team_say',
              CHANNEL_TOOLS_TEXT.sayDescription,
              {
                text: z.string().max(4000).describe(CHANNEL_TOOLS_TEXT.sayText),
                mentions: z
                  .array(z.string())
                  .optional()
                  .describe(CHANNEL_TOOLS_TEXT.sayMentions),
                kind: z
                  .enum(['chat', 'status'])
                  .optional()
                  .describe(CHANNEL_TOOLS_TEXT.sayKind),
                item_id: z
                  .string()
                  .optional()
                  .describe(CHANNEL_TOOLS_TEXT.sayItemId),
              },
              async (args) => mcpResult(await channel.say(args)),
            ),
            tool(
              'team_note',
              CHANNEL_TOOLS_TEXT.noteDescription,
              {
                text: z.string().max(4000).describe(CHANNEL_TOOLS_TEXT.noteText),
                item_id: z
                  .string()
                  .optional()
                  .describe(CHANNEL_TOOLS_TEXT.noteItemId),
              },
              async (args) => mcpResult(await channel.note(args)),
            ),
            tool(
              'channel_read',
              CHANNEL_TOOLS_TEXT.readDescription,
              {
                limit: z
                  .number()
                  .int()
                  .optional()
                  .describe(CHANNEL_TOOLS_TEXT.readLimit),
              },
              async (args) => mcpResult(await channel.read(args)),
            ),
          ]
        : []),
      ...(member
        ? [
            tool(
              'member_diff',
              MEMBER_TOOLS_TEXT.diffDescription,
              { session_id: z.string().describe(MEMBER_TOOLS_TEXT.diffSessionId) },
              async (args) => mcpResult(await member.diff(args)),
            ),
          ]
        : []),
    ],
  })
}
