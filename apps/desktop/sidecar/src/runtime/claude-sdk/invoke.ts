// Claude Agent SDK one-shot task driver (ADR 0058). The Anthropic branch of
// sdk/invoke.ts delegates here — the task-side twin of claude-sdk/run-stream.ts.
// One-shot (no chat history, no resume — each Task node run is fresh), tasks run
// UNATTENDED so permissions are bypassed (ADR 0024 D-7), native SDK tools only
// (no custom AWOG tools — ADR 0058), MCP via options.mcpServers. SDKMessage is
// mapped onto InvokeCallbacks; a non-null parent_tool_use_id nests SDK-native
// subagent (Task) traces under their spawning tool step (same parentId contract
// the Pi invoke adapter uses).

import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  FROZEN_TOKEN_MIN_LIFETIME_MS,
  resolveCredential,
} from '../../credentials/credential-resolver.js'
import {
  CONFIG_ISOLATION_OPTIONS,
  budgetOptions,
  diagnosticsOptions,
  fallbackModelFor,
  turnCapOption,
  taskBudgetOption,
} from './tuning.js'
import { RpcError } from '../../transport/rpc.js'
import { log } from '../../util/logger.js'
import type { InvokeArgs, InvokeCallbacks, InvokeResult } from '../../sdk/invoke.js'
import { buildRulesPrompt, extractTurnPaths } from '../../rules/inject.js'
import {
  EVIDENCE_PROMPT,
  OUTPUT_SURFACE_PROMPT,
  TASK_CHECKLIST_PROMPT,
  SCRATCH_DIR_PROMPT,
  VERIFY_PROMPT,
} from '../prompts.js'
import { isToolAllowed } from '../tools/index.js'
import { buildApiSdkServers } from './api-sdk-server.js'
import { makeTaskToolGate } from '../permission.js'
import { withBridgedAliases } from '../tools/bridged.js'
import { resolveClaudeBinary } from './binary.js'
import {
  buildSdkEnv,
  commitAttribution,
  effortFromLevel,
  makeForegroundOnlyHook,
  mapClaudeErrorToRpc,
  NO_BACKGROUND_PROMPT,
  thinkingFromLevel,
  toSdkMcpServers,
  toSdkModel,
} from './shared.js'
import { resultErrorMessage } from './shared.js'

interface ContentBlock {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

function toInputRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
}

// Translate SDKMessage → InvokeCallbacks + accumulate InvokeResult. parentId is
// derived per message from parent_tool_use_id: null for the main agent, the Task
// call's id for a subagent (so nested trace nodes nest under the Task step).
function createInvokeAdapter(cb: InvokeCallbacks): {
  handle: (msg: SDKMessage) => void
  result: () => InvokeResult
} {
  let text = ''
  let modelUsed = ''
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let stopReason: string | null = null
  const toolInputs = new Map<string, { name: string; input: Record<string, unknown> }>()
  const thinking = new Map<string, string>()
  let assistantSeq = 0

  const handle = (msg: SDKMessage): void => {
    switch (msg.type) {
      case 'system': {
        const m = msg as { subtype?: string; model?: string }
        if (m.subtype === 'init' && typeof m.model === 'string') modelUsed = m.model
        break
      }
      case 'stream_event': {
        const ev = (
          msg as {
            event?: {
              type?: string
              index?: number
              delta?: { type?: string; text?: string; thinking?: string }
            }
          }
        ).event
        if (!ev) break
        if (ev.type === 'message_start') {
          assistantSeq += 1
        } else if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'text_delta' && ev.delta.text) {
            text += ev.delta.text
            cb.onText?.(ev.delta.text)
          } else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
            const key = `${assistantSeq}-${typeof ev.index === 'number' ? ev.index : 0}`
            thinking.set(key, (thinking.get(key) ?? '') + ev.delta.thinking)
            cb.onThinking?.(`thinking-${key}`, ev.delta.thinking, null)
          }
        }
        break
      }
      case 'assistant': {
        const m = msg as {
          message?: { content?: unknown; usage?: { input_tokens?: number; output_tokens?: number } }
          parent_tool_use_id?: string | null
        }
        const parentId = m.parent_tool_use_id ?? null
        const content = m.message?.content
        if (Array.isArray(content)) {
          for (const raw of content as ContentBlock[]) {
            if (raw.type === 'tool_use' && typeof raw.id === 'string' && typeof raw.name === 'string') {
              const input = toInputRecord(raw.input)
              toolInputs.set(raw.id, { name: raw.name, input })
              cb.onToolUse?.({ id: raw.id, name: raw.name, input, parentId })
            }
          }
        }
        const usage = m.message?.usage
        if (usage) {
          cb.onAssistantMeta?.(
            modelUsed,
            { input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0 },
            parentId,
          )
        }
        break
      }
      case 'user': {
        const m = msg as { message?: { content?: unknown }; parent_tool_use_id?: string | null }
        const parentId = m.parent_tool_use_id ?? null
        const content = m.message?.content
        if (Array.isArray(content)) {
          for (const raw of content as ContentBlock[]) {
            if (raw.type === 'tool_result' && typeof raw.tool_use_id === 'string') {
              const meta = toolInputs.get(raw.tool_use_id) ?? { name: 'tool', input: {} }
              cb.onToolResult?.({
                id: raw.tool_use_id,
                name: meta.name,
                input: meta.input,
                content: raw.content,
                isError: raw.is_error === true,
                parentId,
              })
            }
          }
        }
        break
      }
      case 'result': {
        const m = msg as {
          subtype?: string
          result?: string
          stop_reason?: string | null
          usage?: {
            input_tokens?: number
            output_tokens?: number
            cache_read_input_tokens?: number
            cache_creation_input_tokens?: number
          }
          modelUsage?: Record<string, unknown>
        }
        if (m.usage) {
          inputTokens = m.usage.input_tokens ?? 0
          outputTokens = m.usage.output_tokens ?? 0
          cacheReadTokens = m.usage.cache_read_input_tokens ?? 0
          cacheWriteTokens = m.usage.cache_creation_input_tokens ?? 0
        }
        if (m.subtype === 'success') {
          stopReason = m.stop_reason ?? 'end_turn'
          // Final artifact body: prefer the streamed text; fall back to result.
          if (!text && typeof m.result === 'string') text = m.result
        } else {
          stopReason = 'error'
          // Trần tiền của task (maxBudgetUsd) và các mã dừng khác đều rơi vào đây
          // với `result` rỗng — node-runner chỉ thấy stopReason:'error' nếu không
          // dịch mã ra câu. Ghi vào text để trace của node còn nói được lý do.
          const why = resultErrorMessage(m.subtype, m.result)
          log.warn('claude-sdk task node ended without success', { subtype: m.subtype, why })
          if (!text) text = why
        }
        if (!modelUsed && m.modelUsage) {
          const first = Object.keys(m.modelUsage)[0]
          if (first) modelUsed = first
        }
        break
      }
      default:
        break
    }
  }

  return {
    handle,
    result: () => ({
      text,
      modelUsed,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
        cache_creation_tokens: cacheWriteTokens,
      },
      stopReason,
    }),
  }
}

export async function invokeSdkClaude(args: InvokeArgs, cb: InvokeCallbacks): Promise<InvokeResult> {
  // Demand real runway on the token: buildSdkEnv freezes it into the subprocess
  // env for the whole turn, so a token that expires mid-turn is unrecoverable.
  const { account, cred } = await resolveCredential(
    args.settings.provider,
    args.settings.accountId,
    FROZEN_TOKEN_MIN_LIFETIME_MS,
  )

  // Layer the node agent's AGENT.md + bulk context (already in systemPromptAppend)
  // + workspace rules onto the claude_code preset. The preset supplies engineering
  // procedure and tool discipline (ADR 0058), so those are not repeated here — but
  // per ADR 0071 the verification and evidence contracts ARE appended: the preset
  // does not require a `file:line` citation for claims about the codebase, and
  // AWOG's explicit anti-fabrication rule was missing from this runtime entirely.
  // OUTPUT_SURFACE_PROMPT (ADR 0077) is appended for a different reason: it does
  // not duplicate the preset, it corrects it — the preset is a CLI prompt and
  // assumes output is printed to a terminal, while a node's answer is rendered as
  // markdown in the GUI and its paste-ready blocks get copied out verbatim.
  const rulesPrompt = await buildRulesPrompt(args.projectIds?.[0], extractTurnPaths(args.prompt))
  // Checklist nudge — same intent as the Pi task path (runtime/invoke.ts). Safe in
  // the append here (unlike the chat path): a task node is a fresh one-shot SDK
  // session, never a `resume`, so nothing freezes stale. Gated on `TaskCreate`:
  // TodoWrite is not on the CLI's tool surface for current models, and the task
  // tools are what replaced it (see TASK_CHECKLIST_PROMPT). A node's task calls
  // render as ordinary trace rows — the folded checklist row is a chat-path
  // affordance (claude-sdk/event-adapter.ts), and a task node's checklist is
  // ACK-only on both runtimes.
  const checklistAllowed = isToolAllowed('TaskCreate', {
    ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
    ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
  })
  const appendParts = [
    args.systemPrompt,
    args.systemPromptAppend,
    rulesPrompt,
    // Safe in the append on this path for the same reason as the checklist nudge
    // below: a task node is a fresh one-shot SDK session, never a `resume`, so
    // nothing here can freeze stale.
    VERIFY_PROMPT,
    // Scratch-space convention: working files go to `.awog/scratch/`, never
    // beside the user's source. Constant, so it rides the append (frozen on
    // Claude SDK resume is fine — it never changes).
    SCRATCH_DIR_PROMPT,
    EVIDENCE_PROMPT,
    OUTPUT_SURFACE_PROMPT,
    checklistAllowed ? TASK_CHECKLIST_PROMPT : undefined,
    // A task node is one query too: a backgrounded subagent dies with it and its
    // notification never arrives (see shared.ts). The hook below forces the
    // synchronous form; this explains the constraint.
    NO_BACKGROUND_PROMPT,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0)
  const append = appendParts.length > 0 ? appendParts.join('\n\n') : undefined
  // External MCP servers + AWOG `api` sources (in-process SDK MCP servers). Merged
  // into one map for options.mcpServers; source ids never collide with mcp ids.
  const mcpServers = await toSdkMcpServers(args.mcpServers)
  // Per-source allowedApiEndpoints (ADR 0060 P4) gate non-GET api calls inside the
  // SDK tool handler — the SAME check the Pi path enforces (isApiCallAllowed).
  const apiServers = buildApiSdkServers(
    args.apiSources,
    args.abortController?.signal,
    args.sourceApiEndpoints,
  )
  const allServers = { ...(mcpServers ?? {}), ...apiServers }
  const claudeBinary = resolveClaudeBinary()
  const sdkModel = toSdkModel(args.settings.modelId)
  // Model dự phòng khi model chính quá tải (tuning.ts). Tính một lần: gọi hai lần
  // trong một conditional spread thì TS không narrow được `string | undefined`.
  const fallbackModel = fallbackModelFor(sdkModel)

  const options: Options = {
    systemPrompt: { type: 'preset', preset: 'claude_code', ...(append ? { append } : {}) },
    // Honor the task's snapshotted `commitCoAuthor` setting via the SDK flag-settings
    // layer. The claude_code preset otherwise adds Claude's own attribution regardless
    // (see commitAttribution).
    settings: { attribution: commitAttribution(args.commitCoAuthor) },
    includePartialMessages: true,
    thinking: thinkingFromLevel(args.settings.level),
    effort: effortFromLevel(args.settings.level),
    // Chẩn đoán + cách ly cấu hình giống nhánh chat (tuning.ts).
    ...diagnosticsOptions('task'),
    ...CONFIG_ISOLATION_OPTIONS,
    ...(fallbackModel ? { fallbackModel } : {}),
    // Trần TIỀN còn lại của task. Task chạy không người trông nên đây là hàng rào
    // đáng giá nhất trong nhóm: trần USD của task xưa nay chỉ được kiểm GIỮA các
    // node, không cứu nổi một node đang cháy tiền.
    ...budgetOptions(args.maxCostUsd),
    ...turnCapOption(),
    // Ngân sách token phía API (alpha) — mặc định TẮT, bật bằng env.
    ...taskBudgetOption(),
    // Subagent của node cũng nên có câu tiến độ như ở chat.
    agentProgressSummaries: true,
    // Skill: bật tường minh, khớp với catalogue AWOG bơm vào prompt (như nhánh chat).
    skills: 'all',
    // Structured output: node gate của task ép đúng schema verdict thay vì để engine
    // dò fenced block trong văn bản tự do (tasks/node-runner.ts).
    ...(args.outputSchema ? { outputFormat: { type: 'json_schema', schema: args.outputSchema } } : {}),
    // Tasks run unattended (ADR 0024 D-7): không hỏi ai, không nhớ gì. `bypassPermissions`
    // ở đây KHÔNG có nghĩa "không có cổng" — nhánh chat dùng đúng cờ này (run-stream.ts)
    // để cổng của SDK không che cổng của AWOG; cổng thật luôn nằm ở hook PreToolUse.
    // Hook này vừa ép `Task` về dạng đồng bộ (kẻo subagent bị giết khi one-shot kết
    // thúc) vừa chạy cổng CHỈ-DENY, để luật `deny` của người dùng ràng buộc task ở CẢ
    // HAI runtime — nhánh Pi đã có từ ADR 0080 F5.
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    hooks: {
      PreToolUse: [{ hooks: [makeForegroundOnlyHook(makeTaskToolGate(args.projectIds?.[0], args.cwd))] }],
    },
    // Whitelist `tools:` của agent node đi vào `tools`, KHÔNG phải `allowedTools`.
    // Xem chú thích dài ở claude-sdk/run-stream.ts: `allowedTools` là danh sách
    // "tự duyệt, không hỏi", không hạn chế gì — dòng này trước đây nói "honour the
    // node agent's tool whitelist" trong khi thực tế không honour gì cả. Nở tên
    // bắc cầu vì tool AWOG trên nhánh này mang tên `mcp__<server>__<tool>`.
    ...(args.allowedTools ? { tools: withBridgedAliases(args.allowedTools) } : {}),
    ...(args.disabledTools ? { disallowedTools: withBridgedAliases(args.disabledTools) } : {}),
    ...(sdkModel ? { model: sdkModel } : {}),
    ...(args.cwd ? { cwd: args.cwd } : {}),
    ...(Object.keys(allServers).length > 0 ? { mcpServers: allServers } : {}),
    ...(args.abortController ? { abortController: args.abortController } : {}),
    // ⚠ KHÔNG có `ARTIFACT_ENV` ở đây, KHÁC đường chat (claude-sdk/run-stream.ts).
    // Cố ý, và đây là chỗ đã bị bật nhầm một lần rồi (013ff66) — lý do ghi lại để
    // không ai bật lại lần nữa.
    //
    // Lập luận của lần bật đó là "node ở đây đã có `Bash` dưới `bypassPermissions`,
    // nên publish một trang không mở thêm hạng rủi ro nào". Nó sai, và phản ví dụ
    // nằm ngay trong repo: tasks/engine.ts (node 'discuss') khai
    // `disabledTools: ['Write','Edit','MultiEdit','NotebookEdit','Bash']` với đúng
    // một dòng chú thích "discussion must not touch the repo" — tức KHÔNG phải node
    // nào cũng có `Bash`. Bật env ở tầng này là bật cho MỌI node, kể cả node được
    // thiết kế để không chạm gì; nó vẫn publish được ra một URL công khai.
    //
    // Còn một chỗ lệch nữa: công tắc của người dùng cho tool này là
    // `disabledTools` (SessionConfigPopover) — một công tắc PER-SESSION, không tồn
    // tại trên đường task. Nên bật ở đây là bật một năng lực có hệ quả ra ngoài
    // máy, chạy KHÔNG NGƯỜI TRÔNG (ADR 0024 D-7), mà người dùng không có nút nào
    // để tắt. `makeTaskToolGate` không đỡ được: nó deny-only, nó chỉ chặn thứ người
    // dùng đã tự viết ra luật cấm, và chẳng ai viết sẵn luật cấm cho một tool họ
    // không biết là mình đang bật.
    //
    // Muốn node task publish được thì thứ phải thêm là một công tắc opt-in per-node
    // ĐI KÈM cách hiển thị nó ra UI — không phải một dòng env.
    // Cùng luật với đường chat: ngữ cảnh hạ tầng của node (khi có) đi vào env của
    // CLI, để `aws …` trong `Bash` của node chạm đúng tài khoản đã ghim.
    env: buildSdkEnv(cred, args.settings.infra),
    // Packaged builds: bundled native binary (ADR 0058 P3); dev auto-discovers.
    ...(claudeBinary ? { pathToClaudeCodeExecutable: claudeBinary } : {}),
  }

  log.info('task turn request (claude-sdk)', {
    runtime: 'claude-sdk',
    model: args.settings.modelId,
    account: account.id,
    nativeBinary: !!claudeBinary,
  })

  const adapter = createInvokeAdapter(cb)
  try {
    for await (const msg of query({ prompt: args.prompt, options })) {
      adapter.handle(msg)
    }
  } catch (err) {
    throw mapClaudeErrorToRpc(err)
  }
  if (args.abortController?.signal.aborted) throw new RpcError(-32023, 'CANCELED')

  const result = adapter.result()
  log.info('task turn done (claude-sdk)', {
    runtime: 'claude-sdk',
    model: result.modelUsed,
    inputTokens: result.usage.input_tokens,
    outputTokens: result.usage.output_tokens,
    stopReason: result.stopReason,
  })
  return { ...result, modelUsed: result.modelUsed || args.settings.modelId }
}
