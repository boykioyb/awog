// Model-initiated transcript surfaces on the Claude SDK path
// (docs/features/session-model-surfaces.md §4).
//
// One in-process SDK MCP server keyed `awogsurfaces` → the SDK exposes
// `mcp__awogsurfaces__mark_chapter` / `_send_user_file` / `_suggest_task` /
// `_suggest_followups`. The handlers are the SAME functions the Pi AgentTools call
// (runtime/tools/surface-tools.ts), so the budgets, the refusal texts, the path
// validation and the per-session ledger are one implementation — which is the
// point: a user on an Anthropic account and a user on any other provider must get
// the same transcript, and two copies of an abuse guard drift apart.
//
// Only the parameter SCHEMAS are declared twice (TypeBox there, zod here); the
// descriptions — guard layer 1, the policy the model actually reads — are the
// shared SURFACE_TOOL_TEXT constants.
//
// NAMING: our tool names (`mark_chapter`, …) do NOT start with `mcp_`. That prefix
// is reserved by Anthropic and a custom tool using it makes an OAuth turn 400 (the
// repo already paid for that once, with `mcp_describe`/`mcp_call`). The `mcp__`
// namespace the SDK prepends to a bridged MCP tool is the API's own convention and
// is unaffected — same as `mcp__awogwiki__*`.

import { z } from 'zod'
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk'
import {
  SURFACE_MCP_SERVER,
  SURFACE_TOOL_TEXT,
  createSurfaceTurnCounters,
  rememberResolvedSurface,
  runMarkChapter,
  runSendUserFile,
  runSuggestTask,
  runSuggestFollowups,
  runReportFindings,
  type SurfaceRunResult,
} from '../tools/surface-tools.js'
import { WAKEUP_TEXT, createWakeupRunner } from '../tools/wakeup-tool.js'
import { MAX_WAKEUP_NOTE_LEN } from '../../schedules/schema.js'

// A refused call (budget guard, no usable path) has no surface. It must come back
// flagged `isError` — that is what makes step-mapper render it as a failed row
// instead of a chapter that never happened, and what tells the model it was
// refused (the guards report failure in a return field, not by throwing).
function finish(
  toolName: string,
  args: Record<string, unknown>,
  result: SurfaceRunResult,
): { content: { type: 'text'; text: string }[]; isError?: boolean } {
  if (result.surface) {
    // The Claude SDK gives a tool result no `details` side channel, so park the
    // VALIDATED payload for step-mapper to claim (surface-tools.ts explains the
    // correlation and its limits). Without this a `send_user_file` card would fall
    // back to the raw arguments, i.e. an empty file list.
    rememberResolvedSurface(toolName, args, result.surface)
  }
  return {
    content: [{ type: 'text', text: result.text }],
    ...(result.surface ? {} : { isError: true }),
  }
}

export function buildSurfaceToolsSdkServer(
  // Session the turn belongs to — key of the per-session abuse ledger.
  sessionId: string,
  // The session's workspace root: the only directory send_user_file may hand out.
  cwd: string,
): McpSdkServerConfigWithInstance {
  // Guard layer 2. This server is rebuilt inside runStream, i.e. once per turn, so
  // these counters are exactly "per reply" — the same property the Pi factory
  // relies on.
  const turn = createSurfaceTurnCounters()
  // `schedule_wakeup` đi nhờ server này thay vì có server riêng (gói #14). Nó
  // KHÔNG phải một "transcript surface", nhưng mọi thứ quyết định nơi đặt đều
  // trùng: cùng điều kiện cấp phát (chỉ chat session — file này CHÍNH LÀ đường
  // chat), cùng vòng đời (dựng lại mỗi lượt, nên bộ đếm là trần theo lượt), và
  // quan trọng nhất là step-mapper đã có sẵn `unbridgeSurfaceToolName` gấp
  // `mcp__awogsurfaces__<tool>` về tên trần MỘT lần. Dựng `awogwake` riêng thì
  // phải viết thêm một cơ chế gấp tên nữa, hoặc liệt kê hai cách viết ở khắp nơi
  // như wiki/memory đang phải làm — tức tự tạo thêm bề mặt cho đúng lớp bug
  // "tool bắc cầu đổi tên" đã cắn ba lần.
  const runWakeup = createWakeupRunner(sessionId)

  return createSdkMcpServer({
    name: SURFACE_MCP_SERVER,
    version: '1.0.0',
    // Four small schemas, and the model has no reason to go looking for them: it
    // does not tool-search for "how do I offer follow-ups", it either sees the tool
    // at the moment a phase ends or the surface never happens. Deferring them
    // behind tool search would leave the feature advertised and unused, which is
    // the failure mode this whole PR exists to fix.
    alwaysLoad: true,
    tools: [
      tool(
        'mark_chapter',
        SURFACE_TOOL_TEXT.markChapter.description,
        {
          title: z.string().describe(SURFACE_TOOL_TEXT.markChapter.title),
          summary: z.string().optional().describe(SURFACE_TOOL_TEXT.markChapter.summary),
        },
        async (args) => finish('mark_chapter', args, runMarkChapter(args, sessionId, turn)),
      ),
      tool(
        'send_user_file',
        SURFACE_TOOL_TEXT.sendUserFile.description,
        {
          files: z.array(z.string()).describe(SURFACE_TOOL_TEXT.sendUserFile.files),
          caption: z.string().optional().describe(SURFACE_TOOL_TEXT.sendUserFile.caption),
        },
        // Both safety layers live in runSendUserFile: assertInsideWorkspace
        // (invariant #2) AND a mandatory stat. A path outside the workspace or one
        // that does not exist never becomes a card — it is reported back instead.
        async (args) => finish('send_user_file', args, await runSendUserFile(args, cwd)),
      ),
      tool(
        'suggest_task',
        SURFACE_TOOL_TEXT.suggestTask.description,
        {
          title: z.string().describe(SURFACE_TOOL_TEXT.suggestTask.title),
          tldr: z.string().describe(SURFACE_TOOL_TEXT.suggestTask.tldr),
          prompt: z.string().describe(SURFACE_TOOL_TEXT.suggestTask.prompt),
        },
        async (args) => finish('suggest_task', args, runSuggestTask(args, sessionId, turn)),
      ),
      tool(
        'suggest_followups',
        SURFACE_TOOL_TEXT.suggestFollowups.description,
        {
          options: z.array(z.string()).describe(SURFACE_TOOL_TEXT.suggestFollowups.options),
        },
        async (args) => finish('suggest_followups', args, runSuggestFollowups(args, turn)),
      ),
      tool(
        'schedule_wakeup',
        WAKEUP_TEXT.description,
        {
          in_seconds: z.number().describe(WAKEUP_TEXT.inSeconds),
          // Trần độ dài nằm trong SCHEMA để khớp bản TypeBox của nhánh Pi
          // (wakeup-tool.ts). Hàng rào THẬT vẫn là `armWakeup` — nó kiểm độ dài
          // TRƯỚC khi chuỗi đi qua bộ lọc bí mật — nhưng để hai runtime lệch nhau
          // ở lớp phòng thủ đầu tiên là tự tạo một khác biệt không ai giải thích được.
          note: z.string().max(MAX_WAKEUP_NOTE_LEN).describe(WAKEUP_TEXT.note),
        },
        async (args) => {
          const r = await runWakeup(args.in_seconds, args.note)
          // `isError` phải đi qua cầu: một lần đặt BỊ TỪ CHỐI (hết chỗ, note quá
          // dài) không phải một bước thành công — nhánh Pi phân biệt bằng
          // `details.isError`, còn ở đây chỉ có cờ này.
          return {
            content: [{ type: 'text' as const, text: r.text }],
            ...(r.isError ? { isError: true } : {}),
          }
        },
      ),
      tool(
        'report_findings',
        SURFACE_TOOL_TEXT.reportFindings.description,
        {
          findings: z
            .array(
              z.object({
                file: z.string().describe(SURFACE_TOOL_TEXT.reportFindings.file),
                line: z.number().optional().describe(SURFACE_TOOL_TEXT.reportFindings.line),
                // Tập ĐÓNG, khớp bản TypeBox của nhánh Pi. Giá trị lạ bị loại cả
                // dòng chứ không ép về mặc định — xếp một lỗi chặn xuống `minor`
                // là báo cáo sai, tệ hơn không báo.
                severity: z
                  .enum(['blocker', 'major', 'minor'])
                  .describe(SURFACE_TOOL_TEXT.reportFindings.severity),
                summary: z.string().describe(SURFACE_TOOL_TEXT.reportFindings.summary),
                failure: z.string().describe(SURFACE_TOOL_TEXT.reportFindings.failure),
                verdict: z.string().optional().describe(SURFACE_TOOL_TEXT.reportFindings.verdict),
              }),
            )
            .describe(SURFACE_TOOL_TEXT.reportFindings.findings),
          scope: z.string().optional().describe(SURFACE_TOOL_TEXT.reportFindings.scope),
        },
        // Ba lớp guard + `assertInsideWorkspace` + `stat` nằm trong runReportFindings,
        // dùng chung với nhánh Pi. Chỉ schema tồn tại hai bản (TypeBox vs zod), vì
        // hai runtime nói hai thư viện schema khác nhau.
        async (args) =>
          finish('report_findings', args, await runReportFindings(args, cwd, sessionId, turn)),
      ),
    ],
  })
}
