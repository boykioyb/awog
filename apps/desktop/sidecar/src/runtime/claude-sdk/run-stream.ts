// Claude Agent SDK streaming chat runner (ADR 0058 — dual runtime, "full craft").
// sessions/runner.ts's runStream routes here for the ANTHROPIC provider; every
// other provider stays on the Pi path (runtime/run-stream.ts).
//
// Unlike the Pi path this uses the SDK's NATIVE tools + agent loop + system
// prompt — there are NO custom AWOG tools on this path (ADR 0058: the SDK's
// first-party tool discipline is exactly what we want; injecting custom tools
// would dilute it). AWOG only:
//   - resolves the Anthropic credential and hands it to the SDK subprocess via
//     `options.env` (OAuth → CLAUDE_CODE_OAUTH_TOKEN, key → ANTHROPIC_API_KEY);
//     the token is never logged and never emitted to the UI (invariant #1),
//   - layers the agent's AGENT.md + rules + style onto the claude_code preset
//     via `systemPrompt.append`,
//   - lets the SDK own conversation history + compaction via its session store
//     (`resume: sdkSessionId`); the new/rotated session id is returned so the
//     caller persists it (JSONL still records messages for the UI),
//   - adapts the SDKMessage stream back to the same StreamCallbacks/steps the UI
//     already renders (claude-sdk/event-adapter.ts).

import { createHash, randomUUID } from 'node:crypto'
import {
  query,
  type Options,
  type HookInput,
  type HookJSONOutput,
  type SDKUserMessage,
  type Settings,
} from '@anthropic-ai/claude-agent-sdk'

import {
  FROZEN_TOKEN_MIN_LIFETIME_MS,
  resolveCredential,
  type Credential,
} from '../../credentials/credential-resolver.js'
import { RpcError } from '../../transport/rpc.js'
import { log } from '../../util/logger.js'
import type { RunNonStreamArgs, RunStreamResult, StreamCallbacks } from '../../sessions/runner.js'
import type { ContextChars, SessionAttachment, TodoItem } from '../../types/shared.js'
import { makeBeforeToolCall, withTurnBudget, type BeforeToolCall } from '../permission.js'
import type { AskUserQuestionFn } from '../permission-types.js'
import { buildRulesPrompt, extractTurnPaths } from '../../rules/inject.js'
import { buildStylePrompt } from '../../style/styles.js'
import {
  EVIDENCE_PROMPT,
  OUTPUT_SURFACE_PROMPT,
  TASK_CHECKLIST_PROMPT,
  SCRATCH_DIR_PROMPT,
  VERIFY_PROMPT,
} from '../prompts.js'
import { buildCurrentStateBlock, collectWorkspaceSnapshot } from '../../context/environment.js'
import { isToolAllowed } from '../tools/index.js'
import { updateSessionMetadata } from '../../sessions/store.js'
import { ARTIFACT_ENV } from './artifact.js'
import { ASK_USER_QUESTION_TOOL, QUESTION_ENV, makeAskUserQuestionGate } from './ask-user-question.js'
import { createClaudeEventAdapter } from './event-adapter.js'
import { makeElicitationHandler } from './elicitation.js'
import {
  CONFIG_ISOLATION_OPTIONS,
  budgetOptions,
  diagnosticsOptions,
  fallbackModelFor,
  turnCapOption,
} from './tuning.js'
import { buildApiSdkServers } from './api-sdk-server.js'
import { buildSourceToolsSdkServer } from './source-sdk-server.js'
import { buildSshToolsSdkServer } from './ssh-sdk-server.js'
import { buildWikiToolsSdkServer } from './wiki-sdk-server.js'
import { buildLogtimeToolsSdkServer } from './logtime-sdk-server.js'
import { hasLogtimeLinks } from '../../logtime/store.js'
import { hasWikiContext } from '../../wiki/inject.js'
import { buildMemoryToolsSdkServer } from './memory-sdk-server.js'
import { buildSurfaceToolsSdkServer } from './surface-sdk-server.js'
import { isReservedAwogServerName, withBridgedAliases } from '../tools/bridged.js'
import { buildTerminalToolsSdkServer } from './terminal-sdk-server.js'
import { TERMINAL_MCP_SERVER } from '../tools/read-terminal-tool.js'
import { BROWSER_MCP_SERVER, buildBrowserToolSdkServer } from './browser-sdk-server.js'
import { isBrowserToolName } from '../tools/browser-tool.js'
import { noteBrowserToolUse } from '../../sessions/browser-previews.js'
import { buildDevServerSdkServer } from './dev-server-sdk-server.js'
import { DEV_SERVER_MCP_SERVER } from '../tools/dev-server-tool.js'
import { buildCodeIndexSdkServer } from './code-index-sdk-server.js'
import { CODE_INDEX_MCP_SERVER } from '../tools/code-index-tool.js'
import { buildSessionMessagingSdkServer } from './session-messaging-sdk-server.js'
import { SESSION_MESSAGING_MCP_SERVER } from '../tools/session-tools.js'
import { buildTeamSdkServer } from './team-sdk-server.js'
import { TEAM_MCP_SERVER } from '../tools/board-tools.js'
import { SURFACE_MCP_SERVER } from '../tools/surface-tools.js'
import { hasMemory, hasMemoryBodies } from '../../memory/inject.js'
import { listHosts } from '../../ssh/store.js'
import { renderHistoryPrefix } from '../history-prefix.js'
import { resolveClaudeBinary } from './binary.js'
import {
  IDLE_SETTLE_MS,
  LiveClaude,
  TurnState,
  acquireLive,
  createPromptChannel,
  isPassiveAfterResult,
  makeRoomForSpawn,
  sessionStateOf,
  type LiveTurn,
  type SoftConfig,
} from './live-process.js'
import { readTaskOutputTail } from './task-output.js'
import {
  BACKGROUND_TURN_PROMPT,
  autoCompactFromContext,
  buildSdkEnv,
  effortFromSettings,
  mapClaudeErrorToRpc,
  sdkSettings,
  thinkingFromSettings,
  toSdkMcpServers,
  toSdkModel,
} from './shared.js'

// Plan-mode nudge (mirrors the Pi path). The gate blocks all writes/exec in plan
// mode, so tell the model to investigate read-only then present its plan via the
// SDK's native ExitPlanMode tool instead of attempting edits. Two clauses matter
// on THIS path specifically: (1) "do not restate the plan in plain text" — the
// ExitPlanMode input is rendered as the plan card, so a prose copy just duplicates
// it in the reply bubble; (2) "STOP after ExitPlanMode, add no further reply" —
// we run bypassPermissions (own gate), so unlike native plan mode the SDK
// auto-approves ExitPlanMode and would otherwise let the model keep going.
const PLAN_MODE_PROMPT = `<plan-mode>
You are in PLAN MODE. You may ONLY use read-only tools (Read, Grep, Glob) to investigate the task — every write or shell command is blocked.

When you have understood the task and formed a concrete approach, call the \`ExitPlanMode\` tool with your plan as markdown: a short rationale followed by a numbered or bulleted list of the steps you intend to take. Do NOT write code or restate the plan in plain text — the plan you pass to \`ExitPlanMode\` is shown to the user directly, so writing it again as a normal reply only duplicates it. Once you call \`ExitPlanMode\`, STOP: do not begin implementing and do not add any further reply — wait for the user to approve.
</plan-mode>`

// Permission gate on the Claude SDK path. The SDK's own `canUseTool` callback is
// unreliable (S0: it does not fire for many tools in default mode), so — exactly
// like craft — we run in `bypassPermissions` and enforce AWOG's 4-mode gate via a
// PreToolUse hook, reusing the SAME makeBeforeToolCall + canUseTool park as the Pi
// path so gating behaviour and the UI prompt are identical across runtimes. The
// hook fires for EVERY tool call, so 'ask'/'accept-edits' reliably prompt.
function makePreToolUseHook(
  turns: TurnState,
  scope: string | undefined,
): (input: HookInput, toolUseID: string | undefined, options: { signal: AbortSignal }) => Promise<HookJSONOutput> {
  return async (input, _toolUseID, { signal }) => {
    if (input.hook_event_name !== 'PreToolUse') return { continue: true }
    // AskUserQuestion is not a permission — it IS the question card, and the CLI only
    // hands it to the host because its tool declares `requiresUserInteraction`. That
    // hand-off is skipped when a hook has already decided the call (or rewritten its
    // input), so deciding it here would silently swallow the question. Let it fall
    // through to `canUseTool`, which owns it (ask-user-question.ts).
    //
    // What this costs, stated rather than hidden: a question does not count toward the
    // per-turn tool budget and a deny RULE on this tool name is not consulted. Both are
    // acceptable for a read-only tool whose whole effect is "wait for the user" — and
    // the real off-switch survives, since `disabledTools` reaches the CLI as
    // `disallowedTools` and unregisters the tool outright.
    if (input.tool_name === ASK_USER_QUESTION_TOOL) return { continue: true }
    // Rebuild the context makeBeforeToolCall reads (name/id/args). It may mutate
    // `toolInput` in place to apply an approved input override → we forward that.
    const toolInput =
      input.tool_input && typeof input.tool_input === 'object'
        ? { ...(input.tool_input as Record<string, unknown>) }
        : {}
    const ctx = {
      toolCall: { name: input.tool_name, id: input.tool_use_id },
      args: toolInput,
    } as unknown as Parameters<BeforeToolCall>[0]
    const gate = turns.ctx?.gate
    if (!gate) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'No active turn to authorise this call.',
        },
      }
    }
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
    // Thẻ xem trước trang (docs/features/browser-preview-card.md): handler MCP của
    // browser_tool không nhận tool_use id, nên ghi phiếu ở đây — sau khi cổng đã cho
    // qua, trước khi handler chạy — để nó nhận ra step nào mà lưu ảnh.
    if (scope && isBrowserToolName(input.tool_name)) {
      noteBrowserToolUse(scope, input.tool_use_id, toolInput)
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

// ── Attachments → Claude prompt content ─────────────────────────────────────
// The SDK's plain-string `prompt` form CANNOT carry images (the root cause of
// "the model didn't receive the image" on the Anthropic path). To send an
// attachment we switch to the streaming-input form — an async generator yielding
// a single user message whose `content` is a block array: the prompt text, then
// any text-file attachments (delimited), then image blocks. Mirrors the Pi path's
// historyUser (context-builder.ts) so both runtimes deliver attachments identically.

// Anthropic accepts only these image mime types; anything else is dropped (with a
// warn) so the text still goes out instead of the whole turn 400-ing.
const SDK_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
type SdkImageMime = (typeof SDK_IMAGE_MIMES)[number]
const isSdkImageMime = (m: string): m is SdkImageMime => (SDK_IMAGE_MIMES as readonly string[]).includes(m)
// Skip an image whose base64 payload exceeds ~9MB raw — one oversized image would
// blow the provider request limit and fail the whole turn (matches context-builder).
const MAX_IMAGE_BASE64_LENGTH = 12 * 1024 * 1024

type ClaudeTextBlock = { type: 'text'; text: string }
type ClaudeImageBlock = {
  type: 'image'
  source: { type: 'base64'; media_type: SdkImageMime; data: string }
}
// Anthropic-native PDF ingestion (Messages API document block). Unlike images this
// works ONLY on this (Claude) path — Pi providers can't take documents, so there a
// PDF degrades to a text reference (context-builder.toFileTextContent).
type ClaudeDocBlock = {
  type: 'document'
  source: { type: 'base64'; media_type: 'application/pdf'; data: string }
}
type ClaudePromptBlock = ClaudeTextBlock | ClaudeImageBlock | ClaudeDocBlock

// Neutralise quotes / newlines so a filename can't break out of its attribute.
function sanitizeAttr(s: string): string {
  return s.replace(/["\r\n]/g, ' ')
}

// Parse an attachment's inline base64 `data:` URL. Returns [mimeType, data] or null.
function parseDataUrl(url: string | undefined): [string, string] | null {
  if (!url) return null
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(url)
  if (!match) return null
  const [, mimeType, data] = match
  return mimeType && data ? [mimeType, data] : null
}

// Parse an image attachment's inline `data:` URL into a Claude image block. Only
// base64 data URLs with an Anthropic-supported mime type and a sane size qualify.
function toClaudeImageBlock(att: SessionAttachment): ClaudeImageBlock | null {
  if (att.type !== 'image') return null
  const parsed = parseDataUrl(att.url)
  if (!parsed) return null
  const [mimeType, data] = parsed
  if (!isSdkImageMime(mimeType)) {
    log.warn('claude-sdk: skipping image with unsupported mime type', { name: att.name, mimeType })
    return null
  }
  if (data.length > MAX_IMAGE_BASE64_LENGTH) {
    log.warn('claude-sdk: skipping oversized image attachment', {
      name: att.name,
      base64Length: data.length,
    })
    return null
  }
  return { type: 'image', source: { type: 'base64', media_type: mimeType, data } }
}

// Parse a PDF file attachment's base64 `data:` URL into a Claude document block.
// Only `application/pdf` data URLs of a sane size qualify.
function toClaudeDocBlock(att: SessionAttachment): ClaudeDocBlock | null {
  if (att.type !== 'file') return null
  const parsed = parseDataUrl(att.url)
  if (!parsed) return null
  const [mimeType, data] = parsed
  if (mimeType !== 'application/pdf') return null
  if (data.length > MAX_IMAGE_BASE64_LENGTH) {
    log.warn('claude-sdk: skipping oversized pdf attachment', {
      name: att.name,
      base64Length: data.length,
    })
    return null
  }
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
}

// A `file`-type attachment as a text block: its `preview` content (delimited) when
// text-readable, else a REFERENCE line naming the file (+ path) so the model knows
// it exists and can Read it with a tool. PDFs with an inline `url` are sent as a
// document block instead (toClaudeDocBlock) — skip them here to avoid duplicating.
function toClaudeFileTextBlock(att: SessionAttachment): ClaudeTextBlock | null {
  if (att.type !== 'file') return null
  const name = sanitizeAttr(att.name || 'attachment')
  if (att.preview && att.preview.trim().length > 0) {
    return { type: 'text', text: `<attached-file name="${name}">\n${att.preview}\n</attached-file>` }
  }
  // Một PDF SẼ đi theo dạng document block thì không cần thêm dòng tham chiếu.
  // Nhưng phải hỏi ĐÚNG câu đó — `toClaudeDocBlock` còn từ chối vì quá cỡ, và bản
  // trước bỏ qua mọi PDF bất kể block kia có được tạo hay không: một PDF vượt trần
  // vì thế BIẾN MẤT hoàn toàn với model, không block, không cả một dòng nói rằng
  // file tồn tại. Nay quá cỡ thì rơi xuống dòng tham chiếu bên dưới.
  if (parseDataUrl(att.url)?.[0] === 'application/pdf' && toClaudeDocBlock(att) !== null) {
    return null
  }
  if (!att.path) return null
  const attrs = `name="${name}" path="${sanitizeAttr(att.path)}"`
  // PDF được nói riêng, y như nhánh Pi (context-builder.ts): `Read` đọc được theo
  // KHOẢNG TRANG (offset = trang đầu, limit = số trang). Câu chung chung "dùng
  // Read" khiến model đòi cả tài liệu 300 trang rồi mới biết là quá lớn.
  if (parseDataUrl(att.url)?.[0] === 'application/pdf') {
    const note =
      'PDF too large to inline. Read it with the Read tool a page range at a time (offset is the first page, limit the page count) if it is inside your working directory.'
    return { type: 'text', text: `<attached-file ${attrs} note="${note}" />` }
  }
  return {
    type: 'text',
    text: `<attached-file ${attrs} note="Binary/document attachment — no inline text. Use the Read tool to open it if it is inside your working directory." />`,
  }
}

// Đính kèm của MỘT lượt, đổi thành block prompt: file-text trước, rồi document,
// rồi ảnh. Export để test được một bất biến đã từng vỡ: **mỗi đính kèm phải để lại
// dấu vết nào đó** — hoặc nội dung, hoặc ít nhất một dòng nói rằng file tồn tại.
// Trước bản vá #12, một PDF vượt trần kích thước rơi khỏi `toClaudeDocBlock` VÀ bị
// `toClaudeFileTextBlock` bỏ qua (vì nó bỏ qua mọi PDF), nên biến mất hoàn toàn:
// model không được cho biết là có file đó.
export function attachmentPromptBlocks(attachments: SessionAttachment[] | undefined): ClaudePromptBlock[] {
  const list = attachments ?? []
  const images = list.map(toClaudeImageBlock).filter((b): b is ClaudeImageBlock => b !== null)
  const docs = list.map(toClaudeDocBlock).filter((b): b is ClaudeDocBlock => b !== null)
  const files = list.map(toClaudeFileTextBlock).filter((b): b is ClaudeTextBlock => b !== null)
  return [...files, ...docs, ...images]
}

// The user message of ONE turn: the turn text + any file/document/image blocks.
// Attachments ride with the CURRENT turn; prior-turn ones persist via the CLI's own
// session store, so there's no re-feed to do here.
//
// Always the structured (streaming-input) form, never the plain-string prompt: the string
// form cannot carry images, and it makes the SDK treat the query as single-turn and close
// the CLI's stdin at the first `result` (sdk.mjs: "First result received for single-turn
// query, closing stdin") — which would kill the process and every background task in it.
// live-process.ts keeps the input open and pushes one of these per turn.
function buildUserMessage(text: string, attachments: SessionAttachment[] | undefined): SDKUserMessage {
  const blocks = attachmentPromptBlocks(attachments)
  let content: string | ClaudePromptBlock[] = text
  if (blocks.length > 0) {
    const all: ClaudePromptBlock[] = []
    if (text) all.push({ type: 'text', text })
    all.push(...blocks)
    content = all
  }
  return {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  }
}

// ── Process reuse ───────────────────────────────────────────────────────────

// Identity of the credential frozen into a process's env. Hashed so no token sits in a
// registry or a log line (invariant #1).
function tokenKeyOf(cred: Credential): string {
  const secret = cred.kind === 'oauth' ? cred.accessToken : `${cred.apiKey}\n${cred.baseURL ?? ''}`
  return createHash('sha256').update(secret).digest('hex')
}

// What `options` says about the CLI process, split in two (ADR 0099):
//
//   fingerprint — the HARD part: everything the CLI reads ONCE at startup and nothing can
//     change afterwards (tools allow/deny, cwd, env, settingSources, agent/skills,
//     permission-relevant flags, attribution…). Two turns with the same fingerprint can
//     share a process; any difference means the live one cannot honour the new turn and
//     is replaced via `resume`, history intact.
//   soft — the part the live `Query` can be told to change (LiveClaude.reconfigure):
//     model, effort, ultracode, thinking on/off and the MCP server set. These do NOT
//     respawn the process, because a respawn kills the background work it owns.
//
// Deliberately NOT in either:
//   - `resume` / `sessionId` — compared separately (acquireLive), against what the live
//     process actually holds;
//   - the credential — compared separately and leniently (acquireLive);
//   - `systemPrompt.append`: the SDK records the system prompt once (`snapshot: true`) and
//     ignores a changed append on `resume`, so a respawn could not apply it either —
//     including it would only kill background work for nothing;
//   - `fallbackModel`: derived from the model, but `--fallback-model` outranks the settings
//     layer so it cannot be changed live; respawning for it would kill background work to
//     fix a backup that only matters under overload. A live process keeps the fallback of
//     the model it was spawned with (LiveClaude.reconfigure logs when that differs);
//   - the per-turn closures (hooks, canUseTool, onElicitation, abortController): they read
//     `TurnState`, so they never differ between turns. Only their PRESENCE is spawn-relevant.
//
// A thinking config that is not plain disabled/adaptive cannot be switched live, so it stays
// in the fingerprint verbatim.
//
// `maxBudgetUsd` IS in the fingerprint, so a session with a hard cost cap respawns every
// turn: the CLI counts that cap from `query()` start while AWOG passes what is LEFT of the
// session budget, which shrinks each turn. Honest degradation (those sessions keep the old
// per-turn process) beats a cap that silently counts spend twice.
//
// `sdkInputs` — per in-process server NAME, the (non-secret-bearing or hashed-only) inputs
// its closure was built from: an edited api source, the wiki/memory write flags, the SSH
// co-pilot connection. They feed the server's digest, so the live process can tell that a
// same-named server must be rebuilt (LiveClaude.reconfigure replaces it).
export function describeOptions(
  options: Options,
  sdkInputs: Record<string, unknown> = {},
): { fingerprint: string; soft: SoftConfig } {
  const {
    resume: _resume,
    sessionId: _sessionId,
    abortController: _abortController,
    hooks: _hooks,
    systemPrompt: _systemPrompt,
    canUseTool,
    onElicitation,
    mcpServers,
    env,
    model,
    effort,
    thinking,
    fallbackModel,
    settings,
    ...rest
  } = options
  const flagSettings: Settings | undefined = typeof settings === 'object' ? settings : undefined
  const { ultracode, ...otherSettings } = flagSettings ?? {}
  const thinkingMode = thinking?.type === 'disabled' ? 'off' : thinking?.type === 'adaptive' ? 'on' : undefined
  const servers = Object.entries(mcpServers ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  // Only what AWOG ADDED on top of the sidecar's own environment, minus the credential.
  const envDelta = Object.entries(env ?? {})
    .filter(([k, v]) => v !== process.env[k] && k !== 'CLAUDE_CODE_OAUTH_TOKEN' && k !== 'ANTHROPIC_API_KEY')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        rest,
        settings: flagSettings ? otherSettings : settings,
        rawThinking: thinkingMode ? null : (thinking ?? null),
        envDelta,
        hasCanUseTool: canUseTool !== undefined,
        hasElicitation: onElicitation !== undefined,
      }),
    )
    .digest('hex')
  return {
    fingerprint,
    soft: {
      model,
      effort,
      ultracode: ultracode === true,
      thinking: thinkingMode ?? 'off',
      fallbackModel,
      // An in-process server is an object graph, so it is identified by its name plus a hash
      // of the inputs its closure captured (`sdkInputs`; per-turn state is read through
      // TurnState, not captured). An external one by a hash of its resolved config.
      mcp: Object.fromEntries(
        servers.map(([name, cfg]) => [
          name,
          cfg.type === 'sdk' ? `sdk:${digestOf(sdkInputs[name] ?? null)}` : digestOf(cfg),
        ]),
      ),
    },
  }
}

const digestOf = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(value, (_k, v: unknown) => (v instanceof RegExp ? `${v}` : v)))
    .digest('hex')
    .slice(0, 16)

// A graceful `error` result whose message says the credential was rejected.
const AUTH_FAILURE_RE = /authenticat|unauthori[sz]ed|\b401\b|invalid (x-)?api[ _-]?key|oauth token/i

const messageSubtype = (msg: object): string | undefined =>
  'subtype' in msg && typeof msg.subtype === 'string' ? msg.subtype : undefined

export async function runStreamClaude(args: RunNonStreamArgs, cb: StreamCallbacks): Promise<RunStreamResult> {
  // Demand real runway on the token: buildSdkEnv freezes it into the subprocess
  // env for the whole turn, so a token that expires mid-turn is unrecoverable.
  const { account, cred } = await resolveCredential(
    args.settings.provider,
    args.settings.accountId,
    FROZEN_TOKEN_MIN_LIFETIME_MS,
  )
  // Per-turn state the long-lived hooks and in-process MCP servers read (live-process.ts).
  // Built for the process this turn MAY spawn; when a live one is reused it is discarded
  // and the live process's own TurnState takes over.
  const turns = new TurnState()

  // systemPrompt: layer the agent's own prompt (AGENT.md) + bulk-loaded context
  // (memory/agents/skills, already folded into systemPromptAppend upstream) +
  // workspace rules ONTO the first-party claude_code preset. Response style is
  // NOT appended here — it rides on the turn prompt instead (see below).
  const rulesPrompt = await buildRulesPrompt(args.projectId, extractTurnPaths(args.pendingText))
  // Response style (ADR 0046). Deliberately kept OUT of the system-prompt append:
  // the Claude Agent SDK resolves the preset system prompt (incl. `append`) ONCE
  // at session creation and IGNORES a changed append on `resume` (docs: system-
  // prompt changes "don't take effect mid-session … start a new session"). A
  // session is created before the user picks a style — and the style can change
  // mid-session — so a system-prompt style would be frozen stale (or absent). We
  // inject it into the TURN PROMPT below so it is re-sent every turn, matching the
  // Pi path (which re-appends it each turn). Rules have the same frozen limitation.
  const stylePrompt = buildStylePrompt(
    args.settings.responseStyle,
    args.settings.responseStyleNoMarkdown,
    // Tier project của style tự viết ({project}/.awog/styles) — không truyền
    // projectId thì chỉ tier global resolve được.
    args.projectId,
  )
  const inPlanMode = args.settings.mode === 'plan'
  // PLAN_MODE_PROMPT is NOT appended here — like the response style, it rides on
  // the turn prompt instead (see below). Plan mode can be toggled on mid-session,
  // but the SDK freezes the append at session creation and ignores it on `resume`,
  // so a frozen append would never reach the model when plan is enabled after the
  // first turn. Re-sending it per turn matches the Pi path (which rebuilds its
  // append every turn).
  // Verification + evidence contracts (ADR 0071). These two are the half of the
  // senior-engineer stack the claude_code preset does NOT supply: it already
  // carries engineering procedure and an output contract (so ENGINEERING_PROMPT /
  // COMMUNICATION_PROMPT would only duplicate and risk contradicting it), but it
  // does not mandate citing `file:line` for claims about the codebase, and AWOG's
  // anti-fabrication rule was absent from this path entirely.
  //
  // The third block, OUTPUT_SURFACE_PROMPT (ADR 0077), is a different category:
  // it does NOT duplicate the preset, it CORRECTS it. The preset is a CLI's system
  // prompt and tells the model its output goes to a command line; on AWOG the
  // transcript is markdown rendered in a resizable GUI panel, and the preset says
  // nothing about hard-wrapping. Correcting a preset assumption that is true for
  // Claude Code but false for AWOG is allowed here; restating what the preset
  // already says is not.
  //
  // Unlike style/plan/checklist above, all three are CONSTANT — they never change
  // mid-session — so the SDK freezing the append at session creation is harmless
  // here and they belong in the cached system prompt rather than on every turn.
  // (Consequence: sessions created before ADR 0071 / 0077 keep the old behaviour
  // until the user starts a new one; a resume cannot pick up a changed append.)
  const appendParts = [
    args.systemPrompt,
    args.systemPromptAppend,
    rulesPrompt,
    VERIFY_PROMPT,
    // Scratch-space convention: working files go to `.awog/scratch/`, never
    // beside the user's source. Constant, so it rides the append (frozen on
    // Claude SDK resume is fine — it never changes).
    SCRATCH_DIR_PROMPT,
    EVIDENCE_PROMPT,
    OUTPUT_SURFACE_PROMPT,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0)
  const append = appendParts.length > 0 ? appendParts.join('\n\n') : undefined
  // The checklist tools are SDK built-ins here (AWOG doesn't own the implementation,
  // unlike the Pi path), so the same allow/deny filter decides whether nudging is
  // honest. Gated on `TaskCreate`, the tool the nudge actually asks for: an agent
  // whose `tools:` whitelist omits it would have the call refused by the SDK, and
  // TodoWrite — the name this used to test — is not on the surface at all for
  // current models (see TASK_CHECKLIST_PROMPT).
  const checklistAllowed = isToolAllowed('TaskCreate', {
    ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
    ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
  })

  // 4-mode permission gate (ADR 0058 P4): reuse the Pi-path makeBeforeToolCall +
  // per-turn budget, driven from the PreToolUse hook below. The gate parks on
  // args.canUseTool for the tools it decides to prompt for (ask/accept-edits).
  const gate = withTurnBudget(
    makeBeforeToolCall(
      args.canUseTool,
      args.settings.mode,
      args.sessionId,
      args.autoApprove ?? false,
      // Per-source P4 gate (ADR 0060). On the Claude SDK path the SDK owns MCP
      // tool listing, so exposure can't be filtered — this gate is the SOLE
      // enforcement of a source's allowedMcpPatterns + trust:'prompt' here.
      {
        ...(args.promptSourceIds ? { promptSourceIds: args.promptSourceIds } : {}),
        ...(args.sourceToolPatterns ? { toolPatterns: args.sourceToolPatterns } : {}),
      },
      // Per-session SSH approval mode (ADR 0064). The SSH tools are bridged as an MCP
      // server below; the gate matches their `mcp__awogssh__ssh_*` names (sshToolName)
      // and keys the allowance by the `host` arg — same gate as Pi.
      args.settings.sshApprovalMode ?? 'prompt',
      // cwd THẬT của lượt: luật viết đường dẫn tương đối phải giải theo thư mục
      // lệnh sẽ chạy, không phải đường dẫn project (ADR 0080).
      args.cwd,
      // Ngữ cảnh hạ tầng của phiên (ADR 0088 §5b) — cột ma trận và nội dung prompt
      // duyệt đều lấy từ đây; vắng nó là cổng quyền tính nhầm sang tài khoản thường.
      args.settings.infra || args.settings.infraFloor
        ? {
            ...(args.settings.infra ? { context: args.settings.infra } : {}),
            ...(args.settings.infraFloor ? { sessionFloor: args.settings.infraFloor } : {}),
          }
        : undefined,
    ),
    args.budget,
    Date.now(),
  )

  const sdkModel = toSdkModel(args.settings.modelId)
  // Model dự phòng khi model chính quá tải (tuning.ts). Tính một lần: gọi hai lần
  // trong một conditional spread thì TS không narrow được `string | undefined`.
  const fallbackModel = fallbackModelFor(sdkModel)

  // NOTE: `/compact` never reaches here — runner.ts routes it to Pi's runCompact
  // (provider-agnostic summarization, ADR 0047). Its checkpoint clears sdkSessionId
  // (session.compacted fold), so the next turn lands in the re-seed branch below
  // with args.compaction set → the fresh SDK session starts from [summary + kept].

  // Prompt: on a fresh SDK session (no resume) with prior AWOG history, prepend a
  // one-shot context block so the first turn isn't blind. With an active compaction
  // checkpoint (right after /compact) the block is [summary + kept turns] so the
  // fresh SDK session starts with REDUCED context (ADR 0047/0058).
  let promptText = args.pendingText
  // A CLI-native slash command (/goal, /context, /usage…) is passed through EXACTLY
  // as typed: the CLI parses a local command only from a message that STARTS with
  // `/`, so every block below would turn it back into prose for the model. Skips the
  // history prefix too — a local command reads the CLI's own session state, not a
  // re-narrated transcript. See RunNonStreamArgs.nativeCommand.
  const nativeCommand = args.nativeCommand === true
  if (!nativeCommand && !args.sdkSessionId && args.history.length > 0) {
    const prefix = renderHistoryPrefix(args.history, args.compaction)
    promptText = prefix ? `${prefix}\n\n${args.pendingText}` : args.pendingText
  }
  // Prepend the response-style directive to the turn prompt so it applies on the
  // resumed path too (the frozen system-prompt append can't carry a mid-session
  // style change — see the buildStylePrompt note above). Only the AWOG user
  // message (params.text) is persisted to our transcript, so this SDK-only prompt
  // shaping never pollutes the visible session history.
  // Volatile orientation (ADR 0071): date + branch + dirty tree + recent commits,
  // rebuilt every turn. The CLI preset injects its own environment block, but it
  // does so when the session is CREATED — across a resumed session that snapshot
  // goes stale exactly like the frozen append. Re-sending it per turn keeps the
  // model's view of the tree current, and matches the Pi path. Prepended before
  // the style/checklist/plan directives below so it ends up adjacent to the
  // user's actual text. Best-effort: a non-repo yields the date alone.
  const workspaceSnapshot = nativeCommand ? undefined : await collectWorkspaceSnapshot(args.cwd)
  if (workspaceSnapshot) {
    promptText = `${buildCurrentStateBlock(workspaceSnapshot)}\n\n${promptText}`
  }
  if (!nativeCommand && stylePrompt) promptText = `${stylePrompt}\n\n${promptText}`
  // Checklist (ADR 0069) + the checklist-tool nudge ride on the turn prompt for the
  // frozen-append reason above. Both MUST be re-sent every turn: the checklist
  // changes whenever the model or the user edits it, and the nudge is what carries
  // AWOG's own rules for it (reconcile before ending the turn; never tick an item
  // you did not finish) plus the correction that TodoWrite is not on this surface.
  if (!nativeCommand && args.sessionChecklist) {
    promptText = `${args.sessionChecklist}\n\n${promptText}`
  }
  if (!nativeCommand && checklistAllowed) {
    promptText = `${TASK_CHECKLIST_PROMPT}\n\n${promptText}`
  }
  // Background work survives the turn here (live-process.ts): say so, so the model starts
  // slow work in the background and ends its reply instead of polling or holding it open.
  if (!nativeCommand) promptText = `${BACKGROUND_TURN_PROMPT}\n\n${promptText}`
  // Plan-mode directive on the turn prompt for the same frozen-append reason: plan
  // can be toggled mid-session, so a system-prompt append would be ignored on
  // `resume`. Prepended last → sits at the front of the turn so the model reliably
  // presents its plan via ExitPlanMode instead of writing it as plain text.
  if (!nativeCommand && inPlanMode) promptText = `${PLAN_MODE_PROMPT}\n\n${promptText}`

  // Attachments (images / text files) need the block form of the user message. Dropped
  // for a native command: the block form would push the `/name` text out of the message's
  // leading position, and no local command reads an image anyway.
  const userMessage = buildUserMessage(promptText, nativeCommand ? undefined : args.pendingAttachments)

  // External MCP servers of the user (SDK-native mechanism, not a custom tool) +
  // AWOG `api` sources as in-process SDK MCP servers (api-sdk-server.ts) + the
  // `awog` source_* setup tools (source-sdk-server.ts, SESSIONS-only, mirroring the
  // Pi includeSourceTools). Merged into ONE map handed to options.mcpServers, và
  // khoá của một server ngoài CHÍNH LÀ source id.
  //
  // Đính chính một câu đã sai ở đúng chỗ này ("source ids are `<slug>_<hex>` nên
  // không đụng khoá `awog`"): đúng với source MỚI, SAI với id MCP DI TRÚ từ bản cũ
  // — id đó không có hậu tố hex và có thể trùng đúng một tên của AWOG. Các server
  // của AWOG gộp SAU CÙNG nên khi trùng thì AWOG thắng, vì thế biên tạo source đã
  // từ chối tên dành riêng (sources/reserved.ts) và migration đã đổi tên id di trú;
  // dòng warn dưới bắt phần còn lại (config có sẵn trên đĩa từ trước hai hàng rào
  // đó). The turn abort signal cancels in-flight api fetches.
  const mcpServers = await toSdkMcpServers(args.mcpServers)
  // Per-source allowedApiEndpoints (ADR 0060 P4) gate non-GET api calls inside the
  // SDK tool handler — the SAME check the Pi path enforces (isApiCallAllowed).
  const apiServers = buildApiSdkServers(args.apiSources, () => turns.signal(), args.sourceApiEndpoints)
  // SSH tools are offered whenever the user has an agent-enabled host (unified model).
  const sshHostsExist = (await listHosts()).some((h) => h.agentEnabled !== false)
  // Wiki tools (ADR 0073 D-7): same handlers as the Pi path, bridged as an
  // in-process SDK MCP server so a wiki lookup works identically on both runtimes.
  const ctxCfg = args.contextConfig
  // wikiAutoWrite bật ⇒ cụm wiki tool luôn hiện kể cả khi wiki rỗng — nếu không,
  // agent không thể tạo trang đầu tiên (gà–trứng). Cùng gate với Pi path.
  const wikiAutoWrite = ctxCfg?.wikiAutoWrite === true
  const wikiAvailable = ctxCfg?.wikiEnabled !== false && (wikiAutoWrite || (await hasWikiContext(args.projectId)))
  // Memory tools (ADR 0073 D-11): writes are opt-in, read appears only when a fact
  // has detail past its one-liner. Same gating as the Pi path.
  const memoryOn = ctxCfg?.memoryEnabled !== false && (await hasMemory(args.projectId))
  const memoryAutoWrite = ctxCfg?.memoryAutoWrite === true
  const memoryBodies = memoryOn && (await hasMemoryBodies(args.projectId))
  // Logtime (ADR 0091): chỉ khi đã nối dự án với PMS — cùng luật với nhánh Pi.
  const logtimeOn = await hasLogtimeLinks()
  // Source nào sắp bị chính AWOG nuốt mất tool thì phải NÓI RA. Không tự đổi tên
  // giữa lượt — đổi id ở đây làm hỏng whitelist per-agent và tiền tố account
  // keychain; việc của dòng này là biến một lỗi câm thành một lỗi đọc được.
  const shadowedSourceIds = [...Object.keys(mcpServers ?? {}), ...Object.keys(apiServers)].filter(
    isReservedAwogServerName,
  )
  if (shadowedSourceIds.length > 0) {
    log.warn('claude-sdk: source id collides with an AWOG built-in MCP server', {
      ids: shadowedSourceIds,
      note: 'every tool of these sources is lost on this runtime — rename the source id',
    })
  }
  const allServers = {
    ...(mcpServers ?? {}),
    ...apiServers,
    // source_* conversational setup tools → mcp__awog__source_*.
    awog: buildSourceToolsSdkServer(),
    // SSH agent tools (ADR 0064) → mcp__awogssh__ssh_* — available when SSH hosts are
    // configured (host is a per-call param; mirrors the Pi run-stream guard). Gated by
    // sshApprovalMode. The co-pilot dock adds ssh_terminal_run (watched shell).
    ...(sshHostsExist ? { awogssh: buildSshToolsSdkServer(args.sshTerminalConnId) } : {}),
    // Wiki lookup → mcp__awogwiki__wiki_search / mcp__awogwiki__wiki_read.
    ...(wikiAvailable
      ? {
          awogwiki: buildWikiToolsSdkServer(args.projectId, wikiAutoWrite),
        }
      : {}),
    // Logtime → mcp__awoglogtime__logtime_day / _projects / _add / _remove.
    // KHÔNG có tool đẩy lên PMS (ADR 0091 D-5): người dùng tự bấm ở trang Logtime.
    ...(logtimeOn ? { awoglogtime: buildLogtimeToolsSdkServer({ canWrite: true }) } : {}),
    // Memory → mcp__awogmemory__memory_remember / _forget / _read.
    ...(memoryAutoWrite || memoryBodies
      ? {
          awogmemory: buildMemoryToolsSdkServer(args.projectId, {
            autoWrite: memoryAutoWrite,
            hasBodies: memoryBodies,
          }),
        }
      : {}),
    // Model-initiated transcript surfaces (docs/features/session-model-surfaces.md)
    // → mcp__awogsurfaces__mark_chapter / _send_user_file / _suggest_task /
    // _suggest_followups. Unconditional HERE and absent from invoke.ts on purpose:
    // this file IS the chat path, and these four address a user reading a
    // transcript — the same reason the Pi side gates them on ToolFilter.chatSession.
    // Same shared handlers, so a chapter or a file card behaves identically on
    // either runtime; step-mapper maps the bridged names back to the bare ones.
    [SURFACE_MCP_SERVER]: buildSurfaceToolsSdkServer(args.sessionId, args.cwd ?? process.cwd(), turns),
    // Embedded browser (ADR 0043) → mcp__awogbrowser__browser_tool. Same handler as
    // the Pi AgentTool, so browsing does not disappear on an Anthropic account.
    // `args.sessionId` là scope sở hữu tab — tab của lượt này chỉ panel của
    // phiên đó mới thấy (browser per-session).
    [BROWSER_MCP_SERVER]: buildBrowserToolSdkServer(args.cwd ?? process.cwd(), args.sessionId),
    // Terminal của NGƯỜI DÙNG (ADR 0019) → mcp__awogterm__read_terminal. Cùng
    // handler với AgentTool của Pi, nên khử bí mật + hàng rào nonce là một bản
    // duy nhất. Vô điều kiện ở đây vì file này CHÍNH LÀ đường chat — đúng điều
    // kiện `filter.chatSession` mà nhánh Pi dùng.
    [TERMINAL_MCP_SERVER]: buildTerminalToolsSdkServer(args.cwd ?? process.cwd()),
    // Chỉ mục symbol + đồ thị import (docs/features/code-index.md) →
    // mcp__awogcode__code_index. Vô điều kiện, đúng như nhánh Pi cấp nó
    // (runtime/tools/index.ts): chỉ ĐỌC, và chỉ mục dựng LƯỜI ở lần gọi đầu nên
    // model không dùng thì không tốn gì.
    [CODE_INDEX_MCP_SERVER]: buildCodeIndexSdkServer(args.cwd ?? process.cwd()),
    // Nhắn giữa các phiên (gói #17) → mcp__awogsessions__list_sessions /
    // _send_session_message. Vô điều kiện ở đây vì file này CHÍNH LÀ đường chat —
    // đúng điều kiện `filter.chatSession` mà nhánh Pi dùng; một task/subagent
    // không có người ngồi đọc hộp thư để bấm giao.
    [SESSION_MESSAGING_MCP_SERVER]: buildSessionMessagingSdkServer(args.sessionId, turns),
    // Tool ê-kíp (Session Teams) → mcp__awogteam__team_item_* / team_say /
    // team_note / channel_read / member_diff. Chỉ có mặt khi phiên NẰM TRONG
    // NHÓM — `buildTeamSdkServer` trả null cho phiên lẻ, đúng điều kiện
    // createBoardTools/createChannelTools trả [] bên nhánh Pi.
    ...(() => {
      const team = buildTeamSdkServer(args.sessionId)
      return team ? { [TEAM_MCP_SERVER]: team } : {}
    })(),
    // Dev server của dự án (docs/features/dev-server.md) → mcp__awogdev__dev_server.
    // KHÔNG vô điều kiện: nhánh Pi gate nó bằng `filter.backgroundExec`, tức
    // `!inPlanMode` — nó nói về chính những background shell mà plan mode cấm tạo,
    // và `start` chỉ có nghĩa khi model được phép chạy `Bash` sau đó. Giữ nguyên
    // điều kiện thay vì nới rộng: nới là một thay đổi hành vi, và phải làm ở nhánh
    // Pi trước để hai runtime không lệch nhau.
    ...(inPlanMode
      ? {}
      : {
          [DEV_SERVER_MCP_SERVER]: buildDevServerSdkServer(args.cwd ?? process.cwd(), args.sessionId),
        }),
  }
  const claudeBinary = resolveClaudeBinary()

  // ── Park CHỜ NGƯỜI ──────────────────────────────────────────────────────────
  // Số lời hỏi người đang mở (AskUserQuestion, và elicitation của MCP — cả hai park
  // trên cùng một promise ở sessions/questions.ts).
  //
  // LỖI THẬT: `waitingCount()` bên dưới chỉ đếm BACKGROUND TASK (shell nền, subagent,
  // workflow). Một câu hỏi đang chờ người thì nó đếm ra 0, nên sau `result` ta tự
  // `armIdleSettle()` — và 4 GIÂY sau (IDLE_SETTLE_MS) stdin đóng, CLI thoát code 1,
  // `onAbort` unwind park bằng answers rỗng, thẻ lật sang "No answer given". Người
  // dùng thấy đúng một nhịp nháy rồi câu hỏi tự trả lời "không chọn gì".
  //
  // Process nay sống qua lượt nên handler hỏi người (gate AskUserQuestion + elicitation
  // — dựng MỘT lần lúc spawn) không được capture `args.askUserQuestion` của lượt đầu: nó
  // đọc handler của lượt HIỆN TẠI từ `turns.ctx`, và bộ đếm bọc quanh đúng handler mà cả
  // hai đường hỏi người dùng nên không đường nào đếm sót.
  const askUserQuestion: AskUserQuestionFn | undefined = args.askUserQuestion
    ? async (...a) => {
        const ask = turns.ctx?.askUserQuestion
        if (!ask) throw new Error('No active turn to put this question to.')
        turns.humanParks += 1
        try {
          return await ask(...a)
        } finally {
          turns.humanParks -= 1
          // Trả lời xong mà CLI vì lý do nào đó không phát thêm message nào thì lượt sẽ
          // treo — nên cho lượt arm lại nhịp settle. Mọi message KHÔNG thụ động tới sau
          // đều huỷ nó, nên đây chỉ là lưới an toàn.
          turns.ctx?.onQuestionAnswered?.()
        }
      }
    : undefined
  // The cards those gates render go through the TURN's callbacks (or are held between
  // turns), not through the first turn's `cb` captured at spawn.
  const cardCb: StreamCallbacks = {
    onChunk: () => {},
    onStep: (step) => turns.card(step),
  }
  // Process-lifetime abort: closes the CLI (live-process.ts close()). NOT the turn's — a
  // turn's Stop interrupts the generation and leaves the process and its background
  // tasks running.
  const lifeAbort = new AbortController()
  // A fresh session gets its id from us instead of from the CLI's first message. Three
  // reasons: the live process knows the id it serves from the first byte (acquireLive
  // compares it to the persisted resume handle), the monitor can attribute the process to
  // its session from argv (`--session-id <uuid>`, monitor/classify.ts) exactly as it does
  // a resumed one, and nothing about the first turn depends on parsing an init message.
  const freshCliSessionId = randomUUID()

  const options: Options = {
    // `snapshot: true` (SDK 0.3.260+): record this conversation's system prompt once
    // and reuse it verbatim on every later request and `resume`, instead of rendering
    // it fresh each time. Passing an `append` turns recording OFF by default, so this
    // has to be explicit.
    //
    // It costs this path nothing. The append built above is already CONSTANT per
    // session and already frozen on `resume` (see the appendParts block comment);
    // everything that can change mid-session — style, plan mode, checklist, rules —
    // rides the turn prompt instead. And the preset's own dynamic sections (working
    // directory, auto-memory, git status) going stale is covered: `<current_state>` is
    // prepended to EVERY turn below with a fresh git snapshot, which is both newer and
    // more authoritative than the recorded copy.
    //
    // What it buys is the case the default cannot cover: the CLI changing UNDER a live
    // session — exactly what an app upgrade that bumps claude-agent-sdk does. Today
    // that re-renders the preset, invalidating the prompt-cache prefix and, with
    // extended thinking, discarding the reasoning accumulated so far.
    //
    // Deliberately NOT set on the task path (invoke.ts): a task node has no
    // `<current_state>` on its prompt, so the preset's dynamic sections are its only
    // git/cwd orientation and freezing them would trade live state for cache stability.
    //
    // Server-side recording is still rolling out; where it is not enabled for the
    // account (and on Bedrock/Vertex/Foundry) the flag is accepted and inert.
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      snapshot: true,
      ...(append ? { append } : {}),
    },
    // Honor the Git `commitCoAuthor` setting via the SDK flag-settings layer
    // (highest priority). The claude_code preset otherwise adds Claude's own
    // attribution regardless (see commitAttribution): on → AWOG trailer, off → hidden.
    // Bậc Ultracode (ADR 0089) cũng đi ở lớp này.
    settings: sdkSettings({
      commitCoAuthor: args.commitCoAuthor,
      ultracode: args.settings.ultracode,
    }),
    includePartialMessages: true,
    // Thinking: enable adaptive extended thinking (except 'low' = off) + map the
    // level to Claude Code effort depth (shared.ts). effort alone won't emit
    // thinking blocks — `thinking` must be enabled for reasoning to stream.
    thinking: thinkingFromSettings(args.settings),
    effort: effortFromSettings(args.settings),
    // Gate every tool through our PreToolUse hook; bypassPermissions so the SDK's
    // own (unreliable) permission path doesn't shadow it (ADR 0058 P4).
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    hooks: {
      PreToolUse: [{ hooks: [makePreToolUseHook(turns, args.sessionId)] }],
    },
    // Interactive questions (AskUserQuestion). Supplying this callback is what makes
    // the CLI advertise that tool at all when it runs non-interactively — the SDK
    // turns it into `--permission-prompt-tool stdio`, which the tool's `isEnabled()`
    // demands. Every OTHER tool is still decided by the PreToolUse hook above and
    // never reaches this callback (bypassPermissions answers it first — the SDK warns
    // as much), so this adds no second permission path. Chat only: a task/subagent
    // leaves `askUserQuestion` undefined, and the tool stays off there.
    ...(askUserQuestion
      ? {
          canUseTool: makeAskUserQuestionGate(askUserQuestion, cardCb),
          // MCP elicitation (form / URL auth) → cùng thẻ câu hỏi, cùng park. Không
          // khai callback này thì SDK TỪ CHỐI TỰ ĐỘNG mọi request — một Source cần
          // cấp quyền qua trình duyệt sẽ hỏng câm (elicitation.ts).
          onElicitation: makeElicitationHandler(askUserQuestion, cardCb),
        }
      : {}),
    // AWOG DOES render a per-task stop control (SessionBackgroundChips → the bg
    // registry → Query.stopTask), so say so: the CLI fails closed on absence and
    // would kill every background task on an interrupt. With it declared, a cancel
    // ends only the current turn and tasks are stopped one at a time from the chip.
    perTaskStopAffordance: true,
    // Honour the agent's tool whitelist (Claude Code subagent `tools:` field).
    // Whitelist `tools:` của AGENT.md đi vào `tools`, KHÔNG phải `allowedTools`.
    //
    // Đính chính một hiểu sai đã từng được ghi vào chính chỗ này: theo khai báo của
    // SDK (`sdk.d.ts`), `allowedTools` là danh sách "tự duyệt, không hỏi" — nó
    // KHÔNG hạn chế gì, và doc của nó nói thẳng "to restrict which tools are
    // available, use the `tools` option instead". Vì AWOG chưa bao giờ set `tools`,
    // whitelist năng lực theo agent là NO-OP trên nhánh này: một agent khai
    // `tools: [Read, Grep, Glob]` vẫn có `Bash`/`Write`, và ở mode `execute` thì
    // chạy thẳng không một lời hỏi. Nhánh Pi thì intersect CỨNG (tools/index.ts),
    // nên cùng một AGENT.md có hai mức năng lực khác nhau tuỳ provider.
    //
    // Bỏ hẳn `allowedTools`: hôm nay nó vô hại vì `bypassPermissions` đã tắt engine
    // quyền của CLI và mọi thứ đi qua PreToolUse hook — nhưng nó là một dòng CẤP
    // THÊM quyền đứng chờ ngày ai đó gỡ `bypassPermissions`.
    //
    // Nở tên bắc cầu cho cả hai: tool thật trên nhánh này mang tên
    // `mcp__awogwiki__wiki_read`, nên whitelist viết tên trần mà không nở sẽ tước
    // mất chính tool người dùng muốn giữ. Giữ luôn tên gốc vì họ có thể đã viết sẵn
    // dạng bắc cầu.
    ...(args.allowedTools ? { tools: withBridgedAliases(args.allowedTools) } : {}),
    ...(args.disabledTools ? { disallowedTools: withBridgedAliases(args.disabledTools) } : {}),
    ...(sdkModel ? { model: sdkModel } : {}),
    ...(args.cwd ? { cwd: args.cwd } : {}),
    ...(args.sdkSessionId ? { resume: args.sdkSessionId } : { sessionId: freshCliSessionId }),
    ...(Object.keys(allServers).length > 0 ? { mcpServers: allServers } : {}),
    abortController: lifeAbort,
    // Mở tool `Artifact` của CLI (parity #35). Cổng thật là biến môi trường chứ
    // KHÔNG phải `settings.enableArtifact` — artifact.ts ghi bảng đo và lý do.
    // Chẩn đoán (stderr → log, `--debug` theo env) + model dự phòng khi Anthropic quá
    // tải + khai tường minh nguồn settings/MCP. Xem tuning.ts và
    // docs/reference/claude-sdk-options.md.
    ...diagnosticsOptions('chat'),
    ...CONFIG_ISOLATION_OPTIONS,
    ...(fallbackModel ? { fallbackModel } : {}),
    // Trần TIỀN của lượt: dừng ngay khi cán trần thay vì để lượt sau bị từ chối.
    ...budgetOptions(args.budget?.maxCostUsd),
    ...turnCapOption(),
    // Tóm tắt tiến độ subagent (~30s/lần, fork dùng lại prompt cache của chính nó)
    // → `task_progress.summary`, thứ hàng subagent trong transcript vẫn đang thiếu.
    agentProgressSummaries: true,
    // Gợi ý prompt kế tiếp sau mỗi lượt: đi nhờ prompt cache của lượt cha nên gần
    // như miễn phí, và chỉ được render khi model KHÔNG tự gọi `suggest_followups`
    // (event-adapter.ts). Tự tắt ở lượt đầu, sau lỗi API, trong plan mode và khi
    // tài khoản sát hạn mức — không cần AWOG gác thêm.
    promptSuggestions: true,
    // Thư mục người dùng đính kèm cho lượt: cho tool của CLI đọc được chúng. Đây là
    // ý định tường minh của người dùng (họ vừa gắn folder vào phiên), không phải nới
    // quyền âm thầm — và send-message đã kiểm tuyệt-đối-và-là-thư-mục trước khi tới đây.
    ...(args.extraDirs?.length ? { additionalDirectories: args.extraDirs } : {}),
    // Skill: nói TƯỜNG MINH là bật hết. Bỏ trống không phải "tắt" (doc của SDK), mà
    // AWOG đang tự bơm catalogue `<available_skills>` vào prompt — hai bên phải khớp,
    // kẻo model đọc tên skill trong catalogue rồi gọi một tool từ chối nó.
    // Agent.skillIds whitelist (khi agent khai báo) thu hẹp ĐÚNG danh sách này —
    // catalogue đã lọc theo cùng skillIds ở buildBulkLoad nên hai bên vẫn khớp.
    skills: args.skills && args.skills.length > 0 ? args.skills : 'all',
    // QUESTION_ENV chỉ đi cùng gate: nó bật schema mở rộng của AskUserQuestion, mà
    // tool đó chỉ tồn tại khi có `canUseTool` (ask-user-question.ts).
    env: {
      // Ngữ cảnh hạ tầng đã ghim → `AWS_PROFILE`/`AWS_DEFAULT_REGION` cho CLI (và
      // mọi `Bash` nó spawn). Xem `buildSdkEnv`: trên đường này `Bash` là tool của
      // CLI nên env của tiến trình con là chỗ duy nhất đặt được nó.
      ...buildSdkEnv(
        cred,
        args.settings.infra,
        undefined,
        autoCompactFromContext(args.contextConfig),
        args.settings.ghAccount,
      ),
      ...ARTIFACT_ENV,
      ...(args.askUserQuestion ? QUESTION_ENV : {}),
    },
    // Packaged builds: point at the bundled native binary (ADR 0058 P3); dev leaves
    // it undefined so the SDK auto-discovers from the pnpm store.
    ...(claudeBinary ? { pathToClaudeCodeExecutable: claudeBinary } : {}),
  }

  // ── Which process runs this turn ────────────────────────────────────────────
  // A turn already cancelled while it was still being prepared must not spawn (or wake) a
  // process just to throw it away.
  const signal = args.abortController?.signal
  if (signal?.aborted) throw new RpcError(-32023, 'CANCELED')

  // What each in-process server's closure captured, so an edit to it (an api Source's URL
  // or endpoint rules, the wiki/memory write flags, the SSH co-pilot connection) is seen
  // as a change of THAT server rather than ignored because its name is unchanged.
  const { fingerprint, soft } = describeOptions(options, {
    ...Object.fromEntries(
      (args.apiSources ?? []).map((s) => [s.id, { source: s, endpoints: args.sourceApiEndpoints?.[s.id] ?? null }]),
    ),
    awogwiki: { projectId: args.projectId, autoWrite: wikiAutoWrite },
    awogmemory: {
      projectId: args.projectId,
      autoWrite: memoryAutoWrite,
      bodies: memoryBodies,
    },
    awogssh: { connId: args.sshTerminalConnId ?? null },
  })
  const tokenKey = tokenKeyOf(cred)
  let live = acquireLive(args.sessionId, {
    fingerprint,
    tokenKey,
    resume: args.sdkSessionId,
    anyConfig: nativeCommand,
  })
  // Same hard config, possibly a different model / effort / thinking / MCP set: change
  // those ON the process so the background work it owns survives (a native command skips
  // this — it serves whatever config the caller assembled, see acquireLive). A failed
  // apply closes the process and falls through to the respawn below.
  let reconfigured: string[] = []
  if (live && !nativeCommand) {
    const applied = await live.reconfigure(soft, options.mcpServers, turns)
    reconfigured = applied.changed
    if (!applied.ok) live = undefined
    // The reconfigure awaited: a Stop pressed meanwhile must not start the turn.
    if (signal?.aborted) throw new RpcError(-32023, 'CANCELED')
  }
  const reused = live !== undefined
  if (!live) {
    // A new process: first make room under the cap (evicts the LRU quiet one).
    makeRoomForSpawn(args.sessionId)
    // The adapter belongs to the PROCESS, not the turn: it carries the background-task
    // rows and the checklist tracker from the turn that launched work to the turn that
    // reports it. It starts on this turn's callbacks and is re-pointed per turn below.
    const adapter = createClaudeEventAdapter(cb, {
      // Persist the main agent's checklist as the session's current one — the SDK-path
      // equivalent of the Pi tool layer's todoSink (ADR 0069). Without it the banner/Plan
      // tab can only fall back to the transcript snapshot and a user edit has no
      // authoritative list to write to. The list is replayed from the CLI's task tools
      // (task-checklist.ts), which replaced TodoWrite on this surface.
      onTodos: (todos: TodoItem[]) => {
        void updateSessionMetadata(args.sessionId, { todos })
      },
      // Let a finished background shell show its captured output in the transcript
      // instead of a bare "completed" (task-output.ts validates the path).
      readTaskOutput: readTaskOutputTail,
      // Seed for the task-tool checklist tracker — see ClaudeAdapterHooks.sessionTodos.
      ...(args.sessionTodos ? { sessionTodos: args.sessionTodos } : {}),
    })
    const input = createPromptChannel()
    live = new LiveClaude({
      sessionId: args.sessionId,
      fingerprint,
      soft,
      tokenKey,
      state: turns,
      adapter,
      input,
      lifeAbort,
      query: query({ prompt: input.stream, options }),
      cliSessionId: args.sdkSessionId ?? freshCliSessionId,
    })
  }

  log.info('chat stream request (claude-sdk)', {
    runtime: 'claude-sdk',
    sessionId: args.sessionId,
    model: args.settings.modelId,
    account: account.id,
    accountLabel: account.label,
    resume: !!args.sdkSessionId,
    processReused: reused,
    reconfigured,
    attachWake: args.attachWake === true,
    nativeBinary: !!claudeBinary,
    historyTurns: args.history.length,
  })

  // ── The turn: a span of the live process's message stream ───────────────────
  //
  // The CLI holds the turn open for background subagents/shells and wakes the
  // model when one finishes (`system/task_notification`). That only works while
  // its stdin is open, so we decide when to close — and the ONE authoritative
  // signal for "the turn is over" is `session_state_changed: idle`, which the CLI
  // documents as firing after the held-back result flushes and its background loop
  // exits. `result` is merely "a reply was produced"; the CLI can and does wake the
  // model again afterwards. So `result` only arms a short settle timer (any further
  // non-passive message cancels it) — it never closes stdin directly.
  //
  // Which means the turn can end the moment the reply is complete. The things that keep
  // it open are all about THIS reply: no `idle` yet (the settle timer below), a question
  // parked on the human (no deadline at all), or the user pressing Stop.
  let sawResult = false
  let idleTimer: NodeJS.Timeout | undefined
  let loggedParkedOnQuestion = false
  let turn: LiveTurn | undefined
  // `result` is not turn-over. Wait a beat for `idle`; if the CLI keeps going instead, the
  // next non-passive message cancels this and the continuation streams into the same turn.
  // Passive messages (isPassiveAfterResult) leave it alone, so the deadline stays measured
  // from when it was armed. With `promptSuggestions` on, the CLI has been observed to say
  // `result` + `prompt_suggestion` and never `idle`, hence the timer
  // (docs/features/claude-sdk-idle-settle-prompt-suggestion.md).
  const armIdleSettle = (): void => {
    if (idleTimer) return
    // The handle is dropped when it fires, so a later message is not logged as having
    // "cancelled" a settle that already happened.
    idleTimer = setTimeout(() => {
      idleTimer = undefined
      log.info('claude-sdk turn settled without an idle signal', {
        sessionId: args.sessionId,
      })
      turn?.end()
    }, IDLE_SETTLE_MS)
  }

  // Everything the long-lived hooks and servers read per turn — set BEFORE the message is
  // pushed, so even the first tool call of the turn finds this turn's gate.
  const liveRef = live
  liveRef.state.begin({
    gate,
    cb,
    ...(args.askUserQuestion ? { askUserQuestion: args.askUserQuestion } : {}),
    ...(signal ? { signal } : {}),
    onQuestionAnswered: () => {
      if (sawResult && liveRef.state.humanParks === 0) armIdleSettle()
    },
  })
  liveRef.adapter.beginTurn(cb, args.sessionTodos)
  turn = liveRef.begin({
    message: userMessage,
    attach: args.attachWake === true,
  })
  const thisTurn = turn
  // A cancel interrupts the CLI — the process and its background tasks stay up
  // (perTaskStopAffordance) — and the turn unwinds through the CLI's own
  // `result` + `idle`. The deadline inside cancel() kills a CLI that never answers.
  const onAbort = (): void => liveRef.cancel(thisTurn)
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    for await (const msg of thisTurn.messages) {
      // Any non-passive message is activity: the CLI is alive and working, so a post-
      // `result` settle timer no longer applies — it just proved the turn wasn't over
      // (it woke the model, or is about to say `idle` itself). Passive messages
      // (prompt_suggestion…) prove nothing of the sort and must not touch the timer —
      // doing so is what left turns hanging with no `idle`.
      const passive = isPassiveAfterResult(msg)
      const settleCancelled = !passive && idleTimer !== undefined
      if (!passive) {
        clearTimeout(idleTimer)
        idleTimer = undefined
      }
      // The adapter still sees EVERY message — passive ones too (the suggestion chip).
      liveRef.adapter.handle(msg)
      // Rare by construction (the turn really went on after `result`), and it names the
      // message that held the turn open — the data a future hang needs.
      if (settleCancelled && !(sawResult && sessionStateOf(msg) === 'idle')) {
        log.info('claude-sdk settle cancelled — turn continues', {
          sessionId: args.sessionId,
          type: msg.type,
          subtype: messageSubtype(msg),
        })
      }
      if (msg.type === 'result') {
        sawResult = true
        // NOT the end: `result` says a reply was produced. Wait for `idle` (or the timer).
        if (liveRef.state.humanParks > 0) {
          // Chờ người: không đặt hạn nào cả — người dùng trả lời lúc nào cũng được.
          log.info('claude-sdk turn parked on a question — no idle deadline', {
            sessionId: args.sessionId,
          })
        } else armIdleSettle()
      } else if (sawResult && sessionStateOf(msg) === 'idle') {
        // Also gated on this turn having produced its `result`: a resumed CLI can report
        // itself idle before it has even picked up our prompt.
        if (liveRef.state.humanParks === 0) {
          thisTurn.end()
          break
        }
        // `idle` = "not generating". Waiting on the human the CLI is always idle —
        // ending the turn here would kill the question we are showing.
        if (!loggedParkedOnQuestion) {
          loggedParkedOnQuestion = true
          log.info('claude-sdk idle while asking the user — holding the turn open', {
            sessionId: args.sessionId,
          })
        }
      }
    }
  } catch (err) {
    // The process died or errored mid-turn: it cannot be reused, and a half-dead CLI must
    // not be handed to the next turn.
    liveRef.close('turn failed')
    throw mapClaudeErrorToRpc(err)
  } finally {
    clearTimeout(idleTimer)
    idleTimer = undefined
    signal?.removeEventListener('abort', onAbort)
    // Hand the stream back to the pump. The process (and any background task in it)
    // stays; only this turn's span of it ends.
    thisTurn.end()
  }

  // A mid-stream abort surfaces as CANCELED so send-message routes it through the
  // cancel path (persist the partial reply flagged canceled) — same as the Pi path.
  if (signal?.aborted) {
    throw new RpcError(-32023, 'CANCELED')
  }
  // The process went away without delivering this turn's reply (closed under it — a
  // delete/archive/CLI-attach — or exited cleanly with nothing to say). An empty "done"
  // would be recorded as a successful turn that said nothing.
  if (!sawResult && liveRef.closed) {
    throw new RpcError(-32021, 'chat failed: the Claude CLI process ended before the reply finished')
  }

  const acc = liveRef.adapter.result()
  const cliSessionId = acc.sdkSessionId ?? liveRef.cliSessionId
  // A graceful `error` result that is an auth failure leaves a process holding a token the
  // provider rejected — every later turn on it would fail the same way. Replace it.
  if (acc.stopReason === 'error' && AUTH_FAILURE_RE.test(acc.errorMessage ?? '')) {
    liveRef.close('authentication error')
  }
  const doneMeta = {
    runtime: 'claude-sdk',
    sessionId: args.sessionId,
    model: acc.modelUsed,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    stopReason: acc.stopReason,
    ...(acc.errorMessage !== undefined ? { errorMessage: acc.errorMessage } : {}),
  }
  if (acc.stopReason === 'error') log.warn('chat stream done (claude-sdk)', doneMeta)
  else log.info('chat stream done (claude-sdk)', doneMeta)

  // Context-window breakdown for the UI usage panel. AWOG can't read inside the
  // SDK's resume store, but the SDK context MIRRORS the AWOG transcript (or, after
  // /compact, [summary + kept turns]) — so estimate `history` from the transcript.
  // Without this the gauge omits history entirely → it never grows with the
  // conversation NOR drops after /compact. (systemTools/mcpTools are SDK-internal
  // → omitted; that's a fixed offset, the growing/shrinking `history` is what
  // matters for the gauge.)
  const items = args.contextItems
  const memoryFilesLen = items?.memoryFilesChars ?? 0
  const customAgentsLen = items?.customAgentsChars ?? 0
  const skillsLen = items?.skillsChars ?? 0
  const wikiLen = items?.wikiChars ?? 0
  const memoryLen = items?.memoryChars ?? 0
  const systemPromptLen = (args.systemPrompt ?? '').length
  // Turn-prompt riders (style / plan / checklist / todo nudge) are instructions the
  // model receives every turn even though they don't live in `append` on this path
  // — count them here so the gauge doesn't under-report what we actually send.
  const ridersLen =
    (stylePrompt?.length ?? 0) +
    (inPlanMode ? PLAN_MODE_PROMPT.length : 0) +
    (args.sessionChecklist?.length ?? 0) +
    (checklistAllowed ? TASK_CHECKLIST_PROMPT.length : 0) +
    BACKGROUND_TURN_PROMPT.length
  const instructionsLen =
    Math.max(
      0,
      (append?.length ?? 0) - systemPromptLen - memoryFilesLen - customAgentsLen - skillsLen - wikiLen - memoryLen,
    ) + ridersLen
  // Transcript the SDK context holds: kept turns from the compaction cut onward (or
  // the whole transcript when uncompacted) + the summary — measured TEXT-ONLY via
  // renderHistoryPrefix (exactly what we seed the SDK with). We must NOT
  // JSON.stringify the raw SessionMessages: their `steps[]`/`parts[]` carry UI-only
  // tool I/O (full file contents, terminal output) that is NEVER replayed to the
  // model, which would inflate the gauge far past what is sent and never shrink on
  // /compact. Mirrors the Pi path's historyToAgentMessages estimate.
  const historyLen = renderHistoryPrefix(args.history, args.compaction).length + args.pendingText.length
  const contextChars: ContextChars = {
    systemPrompt: systemPromptLen,
    instructions: instructionsLen,
    customAgents: customAgentsLen,
    skills: skillsLen,
    wiki: wikiLen,
    memory: memoryLen,
    memoryFiles: memoryFilesLen,
    history: historyLen,
    ...(items?.memoryFilesList.length ? { memoryFilesList: items.memoryFilesList } : {}),
    ...(items?.customAgentsList.length ? { customAgentsList: items.customAgentsList } : {}),
    ...(items?.skillsList.length ? { skillsList: items.skillsList } : {}),
    ...(items?.wikiList.length ? { wikiList: items.wikiList } : {}),
    ...(items?.memoryList.length ? { memoryList: items.memoryList } : {}),
  }

  return {
    text: acc.text,
    modelUsed: acc.modelUsed || args.settings.modelId,
    usage: {
      input_tokens: acc.inputTokens,
      output_tokens: acc.outputTokens,
      cache_read_tokens: acc.cacheReadTokens,
      cache_creation_tokens: acc.cacheWriteTokens,
      ...(acc.contextTokens > 0 ? { context_tokens: acc.contextTokens } : {}),
      ...(acc.baseTokens > 0 ? { base_tokens: acc.baseTokens } : {}),
    },
    stopReason: acc.stopReason,
    contextChars,
    // Persisted by the caller so the next turn resumes this SDK session.
    ...(cliSessionId ? { sdkSessionId: cliSessionId } : {}),
    ...(acc.errorMessage !== undefined ? { errorMessage: acc.errorMessage } : {}),
    ...(acc.compactions.length ? { nativeCompactions: acc.compactions } : {}),
  }
}
