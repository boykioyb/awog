// Shared config builders for the Claude Agent SDK runtime (ADR 0058). Used by
// both the session path (run-stream.ts) and the task path (invoke.ts) so the
// credential/env, MCP conversion, model normalisation, effort mapping, and error
// mapping are defined once.

import type {
  Options,
  EffortLevel,
  HookInput,
  HookJSONOutput,
  ThinkingConfig,
} from '@anthropic-ai/claude-agent-sdk'
import { RpcError } from '../../transport/rpc.js'
import { log } from '../../util/logger.js'
import type { Credential } from '../../credentials/credential-resolver.js'
import type { McpServersConfig } from '../permission-types.js'
import type { BeforeToolCall } from '../permission.js'
import type { ThinkingLevel } from '../../types/shared.js'
import { assertSafeUrl } from '../tools/ssrf.js'
import { CO_AUTHOR_TRAILER } from '../../git/co-author.js'

// Commit/PR attribution for the claude_code preset. The preset otherwise injects
// Claude's own "Generated with Claude Code" + `Co-Authored-By: Claude` trailer
// regardless of AWOG's setting — this overrides it to honor the Git
// `commitCoAuthor` toggle: on (default, flag omitted) → the AWOG trailer; off →
// '' (empty string hides attribution entirely, per the SDK's `attribution` docs).
export function commitAttribution(commitCoAuthor?: boolean): { commit: string; pr: string } {
  const text = commitCoAuthor === false ? '' : CO_AUTHOR_TRAILER
  return { commit: text, pr: text }
}

// Map a thrown error to the same RpcError codes the Pi path uses so the UI shows
// identical messages regardless of runtime. Token never logged.
export function mapClaudeErrorToRpc(err: unknown): RpcError {
  if (err instanceof RpcError) return err
  const name = err instanceof Error ? err.name : ''
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()
  if (name === 'AbortError' || lower.includes('aborted') || lower.includes('cancelled')) {
    return new RpcError(-32023, 'CANCELED')
  }
  // `401` must match as a WHOLE token — a bare substring test also fires on an
  // unrelated 4010/1401 in a request id, byte count or exit line, mislabelling
  // a random failure as an expired login.
  if (lower.includes('unauthor') || /\b401\b/.test(lower) || lower.includes('authentication')) {
    return new RpcError(-32020, 'AUTH_EXPIRED: re-authenticate via Settings')
  }
  if (lower.includes('rate limit') || lower.includes('429')) {
    return new RpcError(
      -32022,
      'Rate limited by the provider. Quota exhausted — try a cheaper model or wait a few minutes.',
    )
  }
  return new RpcError(-32021, `chat failed: ${message}`)
}

// Build the SDK subprocess env carrying the Anthropic credential. We do NOT
// mutate the sidecar's own process.env (that would race across concurrent
// sessions on different accounts) — the token lives only in the child's env.
export function buildSdkEnv(cred: Credential): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v
  }
  delete env.CLAUDE_CODE_OAUTH_TOKEN
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_BASE_URL
  // CLAUDE_CONFIG_DIR is deliberately NOT overridden (ADR 0070). It used to
  // point at ~/.awog/claude-sdk to keep the SDK's session store out of the
  // user's real ~/.claude — but that dir holds no skills/, agents/ or
  // commands/, so the SDK's built-in Skill tool resolved nothing while AWOG
  // advertised a full catalogue. Sharing the Claude home fixes that and makes an
  // edit in either tool live in the other; the cost is that AWOG's SDK-path
  // transcripts land in ~/.claude/projects/ alongside CLI sessions.
  // Inheriting the ambient value (if the user set one) keeps the subprocess and
  // claudeHome() in agreement — see util/path.ts.
  //
  // CLI 2.1.233 dropped the todo/task-tracking tools from the DEFAULT tool surface
  // on opus 4.8 / sonnet 5 / fable 5 / mythos 5 and newer, and this flag brings them
  // back. AWOG's session checklist (ADR 0069) is built on them, so opt in explicitly;
  // AWOG's own allow/deny filter (allowedTools / disallowedTools) still decides per
  // agent.
  //
  // What comes back is NOT TodoWrite. Measured against CLI 2.1.263, the flag adds
  // exactly TaskCreate, TaskGet, TaskList and TaskUpdate — the per-item successors —
  // while TodoWrite stays absent on those models. So the checklist on this path is
  // replayed from those calls (claude-sdk/task-checklist.ts) and the nudge names them
  // (TASK_CHECKLIST_PROMPT); asking for TodoWrite here earns only
  // "No such tool available: TodoWrite" and a wasted round-trip.
  env.CLAUDE_CODE_ENABLE_TODO_TOOLS = '1'
  // `system/session_state_changed` is the CLI's AUTHORITATIVE turn-over signal
  // ("'idle' fires after heldBackResult flushes and the bg-agent do-while exits"),
  // and it is emitted only behind this env flag. run-stream needs it: without it
  // the only end-of-turn hint is `result`, which is NOT turn-over — the CLI can
  // deliver a result and then wake the model again (a task notification), and
  // closing stdin at `result` cancels every tool call in that continuation with the
  // CLI's canned "The user doesn't want to take this action right now…" text.
  env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS = '1'
  // Tool search — the thing that makes deferred tool loading actually happen.
  //
  // The CLI carries tool search (`tool_search_tool_regex` / `_bm25`, beta
  // `tool-search-tool-2025-10-19`), and with it only tool NAMES ride in the prompt
  // up front; a schema is fetched the first time the model needs it. But its own
  // setting (`toolSearchEnabled`) DEFAULTS TO FALSE, and the SDK's per-server
  // `alwaysLoad` is documented as "tools are deferred when tool search is enabled".
  //
  // So without this flag the deferral AWOG relies on (alwaysLoadExternalMcp below,
  // and every in-process server that deliberately omits `alwaysLoad`) was a NO-OP:
  // every schema of every attached server was inlined into every request of every
  // turn regardless. That is the difference behind "Tool definitions 192k" in AWOG's
  // usage panel versus Claude Code's own panel reporting 41.2k of tool schemas
  // DEFERRED and out of the prompt on the same machine.
  //
  // Gated on a FIRST-PARTY endpoint on purpose. The CLI's own documentation for this
  // switch: "Enable it only if your endpoint forwards and accepts the request shape
  // it will receive; when it does not, requests fail with HTTP 400." A custom
  // baseURL (proxy, Ollama, a gateway speaking the Anthropic protocol) is exactly
  // the case that cannot be assumed to forward the tool-search shape, so those keep
  // the conservative default and pay the inlined schemas instead of failing.
  const firstParty = cred.kind === 'oauth' || !cred.baseURL
  if (firstParty) env.ENABLE_TOOL_SEARCH = 'true'
  if (cred.kind === 'oauth') {
    env.CLAUDE_CODE_OAUTH_TOKEN = cred.accessToken
  } else {
    env.ANTHROPIC_API_KEY = cred.apiKey
    if (cred.baseURL) env.ANTHROPIC_BASE_URL = cred.baseURL
  }
  return env
}

// ── Nạp tool theo yêu cầu trên nhánh Claude SDK ─────────────────────────────
//
// CLI có tool-search sẵn: mặc định nó HOÃN tool của MCP server, chỉ kéo vào prompt
// khi model đi tìm. `alwaysLoad: true` là công tắc TẮT chính cơ chế đó. Bản trước
// bật cứng cho mọi server người dùng gắn, nên gắn nhiều MCP là đốt token ngay
// turn-1 — và còn một cái giá ít ai để ý: theo chính doc của SDK, `alwaysLoad`
// "blocks startup until the server is connected (capped at the standard 5s connect
// timeout)", tức mỗi server bật cờ này có thể cộng tới 5s vào lượt đầu.
//
// Nay là chính sách TỪNG SERVER, chỉ dựa trên thứ biết được từ config (nhánh này
// không tự list tool — SDK sở hữu kết nối, khác nhánh Pi nơi ta đo được byte
// schema thật). Ba luật, mỗi luật một lý do:
//
//  S1 (mặc định) — HOÃN. Cứ để tool-search của CLI làm việc của nó.
//  S2 (ngoại lệ) — bộ gắn NHỎ (≤ SDK_ALWAYS_LOAD_MAX_SERVERS) thì nạp thẳng.
//     Gắn 1–2 server là ý định rõ ràng ("tôi gắn Playwright để dùng ngay"), chi
//     phí token bị chặn trên bởi đúng 1–2 server, và hoãn ở đây chỉ đổi lấy một
//     vòng tool-search ở gần như mọi lượt. Con số 2 ánh xạ thô sang ngân sách
//     6KB của nhánh Pi (≈2 server cỡ trung), nên hai runtime tiêu xấp xỉ cùng một
//     lượng context cho MCP ở turn-1: Pi đo bằng byte vì đo được, SDK ước bằng số
//     server vì không đo được.
//  S3 (chặn) — KHÔNG BAO GIỜ nạp thẳng một server có `timeoutMs` lớn hơn trần
//     connect 5s của SDK. Người dùng đã tự khai server này cần lâu hơn thế mới
//     đưa được danh sách tool (`npx -y …` cold start): bật `alwaysLoad` chỉ chắc
//     chắn thêm tới 5s chờ chết vào turn-1 mà vẫn không kịp có tool. Hoãn nó đi,
//     tool-search nhặt lên khi server đã sống.
//
// Server MCP in-process của CHÍNH AWOG (`awog`, `awogsurfaces`, `awogwiki`,
// `awogmemory`, `awogssh`) KHÔNG đi qua hàm này — chúng được dựng bằng
// createSdkMcpServer ở claude-sdk/run-stream.ts. Bảng chính sách cho từng cái nằm
// trong docs/features/agent-tools-parity.md; file đó ngoài quyền sở hữu của gói
// này nên chưa áp.
const SDK_ALWAYS_LOAD_MAX_SERVERS = 2
const SDK_CONNECT_CAP_MS = 5_000

// Server này có được nạp thẳng ở turn-1 không (S1/S2/S3 ở trên). Thuần + export
// để test.
export function alwaysLoadExternalMcp(cfg: { timeoutMs?: number }, attachedCount: number): boolean {
  if (attachedCount > SDK_ALWAYS_LOAD_MAX_SERVERS) return false
  if (typeof cfg.timeoutMs === 'number' && cfg.timeoutMs > SDK_CONNECT_CAP_MS) return false
  return true
}

// Convert AWOG's already-resolved MCP set (whitelist-intersected + secrets
// expanded upstream) into the SDK's `options.mcpServers` shape so the SDK spawns
// / connects them natively (ADR 0058: MCP is the SDK's own mechanism, NOT a
// custom tool). `alwaysLoad` is now decided per server by alwaysLoadExternalMcp
// instead of being pinned on. http/sse URLs pass the same
// SSRF guard as the Pi path before we hand them to the SDK (invariant #7); a
// server failing the guard is dropped with a warning rather than blocking the turn.
export async function toSdkMcpServers(
  mcp: McpServersConfig | undefined,
): Promise<NonNullable<Options['mcpServers']> | undefined> {
  if (!mcp) return undefined
  const entries = Object.entries(mcp)
  const out: NonNullable<Options['mcpServers']> = {}
  for (const [name, cfg] of entries) {
    // Đếm theo bộ ĐÃ GẮN, không theo bộ sống sót sau SSRF guard: quyết định phải
    // tất định theo config, chứ không đổi tuỳ vào việc một URL có bị chặn hay không.
    const always = alwaysLoadExternalMcp(cfg, entries.length)
    if (cfg.type === 'stdio') {
      out[name] = {
        type: 'stdio',
        command: cfg.command,
        ...(cfg.args ? { args: cfg.args } : {}),
        ...(cfg.env ? { env: cfg.env } : {}),
        ...(cfg.timeoutMs ? { timeout: cfg.timeoutMs } : {}),
        ...(always ? { alwaysLoad: true } : {}),
      }
    } else {
      try {
        await assertSafeUrl(cfg.url)
      } catch (err) {
        log.warn('claude-sdk: dropping MCP server failing SSRF guard', {
          name,
          err: err instanceof Error ? err.message : String(err),
        })
        continue
      }
      out[name] = {
        type: 'http',
        url: cfg.url,
        ...(cfg.headers ? { headers: cfg.headers } : {}),
        ...(cfg.timeoutMs ? { timeout: cfg.timeoutMs } : {}),
        ...(always ? { alwaysLoad: true } : {}),
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// Strip AWOG's internal `-1m` model variant to the API base id the SDK accepts.
export function toSdkModel(modelId: string): string {
  return modelId.replace(/-1m$/, '')
}

// AWOG ThinkingLevel → SDK effort. AWOG's picker IS the Claude Code effort picker,
// so on the SDK path (native Claude Code) we map DIRECTLY — `extra-high` is the
// SDK's `xhigh`. The Pi path now maps 1:1 as well (thinking.ts, ADR 0078): both
// scales carry the same five names, so a given level asks for the same effort on
// either runtime.
export function effortFromLevel(level: ThinkingLevel): EffortLevel {
  switch (level) {
    case 'low':
      return 'low'
    case 'medium':
      return 'medium'
    case 'high':
      return 'high'
    case 'extra-high':
      return 'xhigh'
    case 'max':
      return 'max'
    default:
      return 'medium'
  }
}

// AWOG ThinkingLevel → SDK extended-thinking config. `effort` alone guides depth
// but does NOT emit thinking blocks; `thinking` must be enabled for the model to
// produce (and stream) reasoning as thinking content. 'low' = thinking off is the
// one ACCEPTED DIVERGENCE from the Pi path, which sends `reasoning: 'low'` there
// (ADR 0078); effort still carries the depth hint at that level. Every higher
// level uses ADAPTIVE thinking (Claude decides when/how much, guided by effort —
// Opus 4.6+/Sonnet 4.6+/Fable 5).
//
// `display: 'summarized'` is REQUIRED for the reasoning text to reach the UI. On
// the subscription (OAuth) path the SDK otherwise defaults to redacted thinking:
// the API streams only pings (`thinking_delta.estimated_tokens`) with empty
// `thinking` text (see sdk.d.ts SDKThinkingTokensMessage), so every thinking step
// collapses to the "Thinking…" placeholder. 'summarized' returns visible reasoning.
export function thinkingFromLevel(level: ThinkingLevel): ThinkingConfig {
  return level === 'low' ? { type: 'disabled' } : { type: 'adaptive', display: 'summarized' }
}

// ── Background work ─────────────────────────────────────────────────────────
//
// The CLI keeps a turn alive for background subagents/shells and wakes the model
// when one settles (`system/task_notification`) — but only while its stdin is
// open. The SDK closes stdin at the FIRST `result` whenever the caller passed a
// STRING prompt (sdk.mjs sets `isSingleUserTurn` from `typeof prompt === 'string'`),
// which killed the CLI process mid-run and made the promised notification
// impossible. The chat path therefore feeds a streaming prompt it holds open until
// no background task is live (run-stream.ts); this prompt tells the model the
// resulting contract.
export function backgroundTurnPrompt(waitCapMs: number): string {
  const capMinutes = Math.max(1, Math.round(waitCapMs / 60_000))
  return `<background-work>
Background work is supported in this session and the turn stays open until it settles: subagents you spawn with \`Task\` (which run in the background by default) and commands you start with \`Bash(run_in_background: true)\` keep running, and you are woken with their result inside this same turn. Use that for genuinely parallel work. What does NOT survive is the END of the turn: never finish your reply expecting to be notified later — if a result matters, wait for it now and answer with it.

The turn is held open for at most ${capMinutes} minutes of background work; past that every live task is stopped and reported as interrupted. So size a watcher to fit inside that budget — a poll loop of \`attempts x interval\` must come to at most ${capMinutes} minutes. When the thing you are watching can legitimately take longer, do not start a watcher that will be cut off: report where it stands and let the user ask you to check again.
</background-work>`
}

// The TASK path (workflow nodes) has no such holding: it is a one-shot query whose
// result ends the node, so a backgrounded subagent there would be killed with it.
// Force the synchronous form on that path — applied to the tool INPUT via the
// PreToolUse hook's `updatedInput`, so it holds regardless of what the model asked.
export function forceForegroundSubagent(
  toolName: string,
  toolInput: Record<string, unknown>,
): void {
  if (toolName === 'Task' && toolInput.run_in_background !== false) {
    toolInput.run_in_background = false
  }
}

// Task-path counterpart of backgroundTurnPrompt(): explains the constraint the
// hook above enforces, so the node doesn't end waiting to be notified.
export const NO_BACKGROUND_PROMPT = `<background-work>
This task node runs as a single one-shot: nothing survives its end, so background work is terminated and no completion notification can reach you. Subagents you spawn with \`Task\` are forced to run synchronously — their result comes back in the same tool call, so just use it. Do not run \`Bash\` with \`run_in_background: true\`, and never end your run waiting to be notified about anything.
</background-work>`

// PreToolUse hook for the UNATTENDED path (tasks). Two jobs:
//
//   1. Áp `forceForegroundSubagent` lên tool input (lý do ban đầu nó tồn tại).
//   2. Chạy cổng CHỈ-DENY, nếu người gọi cấp một cái.
//
// Về (2): ADR 0024 D-7 nói task chạy không cần duyệt — "always allow, no
// permission gate" — và điều đó VẪN đúng cho nửa ALLOW. Nhưng ADR 0080 nói DENY
// "thắng cả `execute` mode, `autoApprove` và `accept-edits`: nó là rào chắn người
// dùng tự dựng, không phải một mức nới lỏng". Task chạy `mode:'execute'` theo cấu
// tạo, nên hai câu đó chỉ hoà hợp khi DENY vẫn ràng buộc task. Nhánh Pi đã có
// `makeTaskToolGate` từ ADR 0080 F5; hook này là bản đối xứng cho nhánh Claude SDK.
//
// Vì sao đối xứng là bắt buộc chứ không phải cho đẹp: runtime được chọn THEO
// PROVIDER (ADR 0058). Không có nó, đổi provider của một agent sang `anthropic`
// làm luật `deny` của người dùng lặng lẽ hết hiệu lực — cùng một task, cùng một
// file luật. Đó đúng là mối nguy ADR 0058 cảnh báo, rơi trúng một biên bảo mật.
//
// `gate` là tuỳ chọn để những chỗ gọi không có ngữ cảnh project giữ nguyên hành vi
// cũ; và bản thân `makeTaskToolGate` degrade về `undefined` khi tra luật lỗi, nên
// đường này chỉ có thể THÊM chặn, không bao giờ làm hỏng workflow đang chạy được.
export function makeForegroundOnlyHook(
  gate?: BeforeToolCall,
): (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal },
) => Promise<HookJSONOutput> {
  return async (input, _toolUseID, { signal }) => {
    if (input.hook_event_name !== 'PreToolUse') return { continue: true }
    const toolInput =
      input.tool_input && typeof input.tool_input === 'object'
        ? { ...(input.tool_input as Record<string, unknown>) }
        : {}
    forceForegroundSubagent(input.tool_name, toolInput)
    if (gate) {
      // Cổng đọc args ĐÃ ghi đè, giống nhánh chat: luật phải xét đúng thứ sẽ chạy.
      const ctx = {
        toolCall: { name: input.tool_name, id: input.tool_use_id },
        args: toolInput,
      } as unknown as Parameters<BeforeToolCall>[0]
      const res = await gate(ctx, signal)
      if (res?.block) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: res.reason || 'Denied.',
          },
        }
      }
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: toolInput,
      },
    }
  }
}

// Một `result` KHÔNG phải 'success' chỉ mang mã lý do; `result` (text) thường rỗng.
// Dịch mã đó thành câu người đọc được, vì đây là thứ duy nhất đến được UI khi lượt
// chết. Mã lạ ⇒ trả chính mã: đoán bừa còn tệ hơn nói thẳng "cái này chưa biết".
export function resultErrorMessage(subtype: string | undefined, text?: string): string {
  const detail = typeof text === 'string' && text.trim() ? text.trim() : ''
  switch (subtype) {
    case 'error_max_budget_usd':
      return detail || 'Stopped: this run reached its cost cap. Raise the cap in config to continue.'
    case 'error_max_turns':
      return detail || 'Stopped: this run reached its maximum number of turns.'
    case 'error_max_structured_output_retries':
      return (
        detail ||
        'Stopped: the model could not produce output matching the required schema after several tries.'
      )
    case 'error_during_execution':
      return detail || 'The run failed during execution.'
    default:
      return detail || `The run ended with ${subtype ?? 'an unknown error'}.`
  }
}
