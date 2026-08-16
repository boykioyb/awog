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

import {
  query,
  type Options,
  type HookInput,
  type HookJSONOutput,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'

import { resolveCredential } from '../../credentials/credential-resolver.js'
import { RpcError } from '../../transport/rpc.js'
import { log } from '../../util/logger.js'
import type { RunNonStreamArgs, RunStreamResult, StreamCallbacks } from '../../sessions/runner.js'
import type {
  ContextChars,
  SessionAttachment,
  SessionCompaction,
  SessionMessage,
  TodoItem,
} from '../../types/shared.js'
import { makeBeforeToolCall, withTurnBudget, type BeforeToolCall } from '../permission.js'
import { buildRulesPrompt, extractTurnPaths } from '../../rules/inject.js'
import { buildStylePrompt } from '../../style/styles.js'
import { TODO_USAGE_PROMPT } from '../prompts.js'
import { isToolAllowed } from '../tools/index.js'
import { updateSessionMetadata } from '../../sessions/store.js'
import { createClaudeEventAdapter } from './event-adapter.js'
import { buildApiSdkServers } from './api-sdk-server.js'
import { buildSourceToolsSdkServer } from './source-sdk-server.js'
import { buildSshToolsSdkServer } from './ssh-sdk-server.js'
import { listHosts } from '../../ssh/store.js'
import { resolveClaudeBinary } from './binary.js'
import {
  BACKGROUND_TURN_PROMPT,
  buildSdkEnv,
  commitAttribution,
  effortFromLevel,
  mapClaudeErrorToRpc,
  thinkingFromLevel,
  toSdkMcpServers,
  toSdkModel,
} from './shared.js'

// How long a turn may stay parked waiting for background work to settle before we
// give up and end the session (the per-turn wallclock budget overrides it when the
// caller set one). Generous: a background build or a deep subagent legitimately
// runs for many minutes; the cap only exists so a wedged task can't hold the
// session lock forever.
const DEFAULT_BACKGROUND_WAIT_MS = 15 * 60_000

// Grace window after the LAST background task settles: if the CLI doesn't wake the
// model within it (ambient tasks are skipped, a failed one may produce no
// continuation), end the turn rather than sit until the cap. Any message cancels it.
const BACKGROUND_GRACE_MS = 45_000

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
  gate: BeforeToolCall,
): (input: HookInput, toolUseID: string | undefined, options: { signal: AbortSignal }) => Promise<HookJSONOutput> {
  return async (input, _toolUseID, { signal }) => {
    if (input.hook_event_name !== 'PreToolUse') return { continue: true }
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
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: toolInput,
      },
    }
  }
}

// Render prior AWOG history as a one-shot context block for the FIRST Claude turn
// on a session that has no SDK session yet (SDK resume can't see AWOG's JSONL).
// Subsequent turns rely on `resume`. When a compaction checkpoint is active (right
// after /compact), seed from [summary + kept turns] (turns from firstKeptMessageId
// onward) instead of the full transcript, so the fresh SDK session starts with
// reduced context (ADR 0047/0058). Kept compact + text-only.
function renderHistoryPrefix(history: SessionMessage[], compaction?: SessionCompaction): string {
  let msgs = history
  let summaryBlock = ''
  if (compaction) {
    const idx = history.findIndex((m) => m.id === compaction.firstKeptMessageId)
    if (idx >= 0) {
      msgs = history.slice(idx)
      summaryBlock = `<summary_of_earlier_conversation>\n${compaction.summary}\n</summary_of_earlier_conversation>\n\n`
    }
  }
  const lines: string[] = []
  for (const m of msgs) {
    if (m.role === 'system') continue
    const text = (m.text ?? '').trim()
    if (!text) continue
    lines.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${text}`)
  }
  const convo =
    lines.length > 0 ? `<conversation_so_far>\n${lines.join('\n\n')}\n</conversation_so_far>` : ''
  return `${summaryBlock}${convo}`.trim()
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
  // A PDF that will ride as a document block is not also a reference.
  if (parseDataUrl(att.url)?.[0] === 'application/pdf') return null
  if (!att.path) return null
  const attrs = `name="${name}" path="${sanitizeAttr(att.path)}"`
  return {
    type: 'text',
    text: `<attached-file ${attrs} note="Binary/document attachment — no inline text. Use the Read tool to open it if it is inside your working directory." />`,
  }
}

// An input stream we hold open on purpose. `close()` lets the generator finish,
// which is what makes the SDK close the CLI's stdin.
interface OpenPrompt {
  stream: AsyncIterable<SDKUserMessage>
  close: () => void
}

// Build the SDK prompt as a STREAMING input that stays open after the first
// `result`, carrying the turn text + any file/document/image blocks. Attachments
// ride with the CURRENT turn; prior-turn ones persist via the SDK's own resume
// store, so there's no re-feed to do here.
//
// Why never the plain-string form: the SDK sets `isSingleUserTurn` from
// `typeof prompt === 'string'` and, for a single-turn query, closes the CLI's
// stdin the moment the FIRST `result` arrives (sdk.mjs: "First result received for
// single-turn query, closing stdin"). That kills the CLI process — and with it any
// background subagent/shell still running — before its completion notification can
// be delivered. With a generator, stdin closes only when the generator finishes,
// so the caller decides when the session may end (see the background bookkeeping
// in runStreamClaude).
function openClaudePrompt(
  text: string,
  attachments: SessionAttachment[] | undefined,
): OpenPrompt {
  const list = attachments ?? []
  const images = list.map(toClaudeImageBlock).filter((b): b is ClaudeImageBlock => b !== null)
  const docs = list.map(toClaudeDocBlock).filter((b): b is ClaudeDocBlock => b !== null)
  const files = list.map(toClaudeFileTextBlock).filter((b): b is ClaudeTextBlock => b !== null)
  let content: string | ClaudePromptBlock[] = text
  if (images.length > 0 || docs.length > 0 || files.length > 0) {
    const blocks: ClaudePromptBlock[] = []
    if (text) blocks.push({ type: 'text', text })
    blocks.push(...files, ...docs, ...images)
    content = blocks
  }
  let release = (): void => {}
  const closed = new Promise<void>((resolve) => {
    release = resolve
  })
  const stream = (async function* (): AsyncGenerator<SDKUserMessage> {
    yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }
    await closed
  })()
  return { stream, close: () => release() }
}

export async function runStreamClaude(
  args: RunNonStreamArgs,
  cb: StreamCallbacks,
): Promise<RunStreamResult> {
  const { account, cred } = await resolveCredential(args.settings.provider, args.settings.accountId)

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
  )
  const inPlanMode = args.settings.mode === 'plan'
  // PLAN_MODE_PROMPT is NOT appended here — like the response style, it rides on
  // the turn prompt instead (see below). Plan mode can be toggled on mid-session,
  // but the SDK freezes the append at session creation and ignores it on `resume`,
  // so a frozen append would never reach the model when plan is enabled after the
  // first turn. Re-sending it per turn matches the Pi path (which rebuilds its
  // append every turn).
  const appendParts = [args.systemPrompt, args.systemPromptAppend, rulesPrompt].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  )
  const append = appendParts.length > 0 ? appendParts.join('\n\n') : undefined
  // TodoWrite is an SDK built-in here (AWOG doesn't own the implementation, unlike
  // the Pi path), so the same allow/deny filter decides whether nudging is honest.
  const todoAllowed = isToolAllowed('TodoWrite', {
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
    ),
    args.budget,
    Date.now(),
  )

  const sdkModel = toSdkModel(args.settings.modelId)

  // NOTE: `/compact` never reaches here — runner.ts routes it to Pi's runCompact
  // (provider-agnostic summarization, ADR 0047). Its checkpoint clears sdkSessionId
  // (session.compacted fold), so the next turn lands in the re-seed branch below
  // with args.compaction set → the fresh SDK session starts from [summary + kept].

  // Prompt: on a fresh SDK session (no resume) with prior AWOG history, prepend a
  // one-shot context block so the first turn isn't blind. With an active compaction
  // checkpoint (right after /compact) the block is [summary + kept turns] so the
  // fresh SDK session starts with REDUCED context (ADR 0047/0058).
  let promptText = args.pendingText
  if (!args.sdkSessionId && args.history.length > 0) {
    const prefix = renderHistoryPrefix(args.history, args.compaction)
    promptText = prefix ? `${prefix}\n\n${args.pendingText}` : args.pendingText
  }
  // Prepend the response-style directive to the turn prompt so it applies on the
  // resumed path too (the frozen system-prompt append can't carry a mid-session
  // style change — see the buildStylePrompt note above). Only the AWOG user
  // message (params.text) is persisted to our transcript, so this SDK-only prompt
  // shaping never pollutes the visible session history.
  if (stylePrompt) promptText = `${stylePrompt}\n\n${promptText}`
  // Checklist (ADR 0069) + the TodoWrite nudge ride on the turn prompt for the
  // frozen-append reason above. Both MUST be re-sent every turn: the checklist
  // changes whenever the model or the user edits it, and the nudge is what makes
  // the model keep the list current at all (the preset alone doesn't — on this
  // path TodoWrite was effectively never called before this).
  if (args.sessionChecklist) promptText = `${args.sessionChecklist}\n\n${promptText}`
  if (todoAllowed) promptText = `${TODO_USAGE_PROMPT}\n\n${promptText}`
  // Background work IS supported here (we hold the CLI session open until it
  // settles — see the bookkeeping below), but only within this turn. Say so, so
  // the model neither avoids it nor assumes it survives past the turn.
  promptText = `${BACKGROUND_TURN_PROMPT}\n\n${promptText}`
  // Plan-mode directive on the turn prompt for the same frozen-append reason: plan
  // can be toggled mid-session, so a system-prompt append would be ignored on
  // `resume`. Prepended last → sits at the front of the turn so the model reliably
  // presents its plan via ExitPlanMode instead of writing it as plain text.
  if (inPlanMode) promptText = `${PLAN_MODE_PROMPT}\n\n${promptText}`

  // Attachments (images / text files) need the streaming-input block form — the
  // string prompt can't carry them. Returns the plain string when nothing usable
  // is attached, so the common text-only turn is unchanged.
  const prompt = openClaudePrompt(promptText, args.pendingAttachments)

  // External MCP servers of the user (SDK-native mechanism, not a custom tool) +
  // AWOG `api` sources as in-process SDK MCP servers (api-sdk-server.ts) + the
  // `awog` source_* setup tools (source-sdk-server.ts, SESSIONS-only, mirroring the
  // Pi includeSourceTools). Merged into ONE map handed to options.mcpServers;
  // source ids don't collide with mcp source ids nor with the `awog` key (source
  // ids are `<slug>_<hex>`). The turn abort signal cancels in-flight api fetches.
  const mcpServers = await toSdkMcpServers(args.mcpServers)
  // Per-source allowedApiEndpoints (ADR 0060 P4) gate non-GET api calls inside the
  // SDK tool handler — the SAME check the Pi path enforces (isApiCallAllowed).
  const apiServers = buildApiSdkServers(
    args.apiSources,
    args.abortController?.signal,
    args.sourceApiEndpoints,
  )
  // SSH tools are offered whenever the user has an agent-enabled host (unified model).
  const sshHostsExist = (await listHosts()).some((h) => h.agentEnabled !== false)
  const allServers = {
    ...(mcpServers ?? {}),
    ...apiServers,
    // source_* conversational setup tools → mcp__awog__source_*.
    awog: buildSourceToolsSdkServer(),
    // SSH agent tools (ADR 0064) → mcp__awogssh__ssh_* — available when SSH hosts are
    // configured (host is a per-call param; mirrors the Pi run-stream guard). Gated by
    // sshApprovalMode. The co-pilot dock adds ssh_terminal_run (watched shell).
    ...(sshHostsExist ? { awogssh: buildSshToolsSdkServer(args.sshTerminalConnId) } : {}),
  }
  const claudeBinary = resolveClaudeBinary()

  const options: Options = {
    systemPrompt: { type: 'preset', preset: 'claude_code', ...(append ? { append } : {}) },
    // Honor the Git `commitCoAuthor` setting via the SDK flag-settings layer
    // (highest priority). The claude_code preset otherwise adds Claude's own
    // attribution regardless (see commitAttribution): on → AWOG trailer, off → hidden.
    settings: { attribution: commitAttribution(args.commitCoAuthor) },
    includePartialMessages: true,
    // Thinking: enable adaptive extended thinking (except 'low' = off) + map the
    // level to Claude Code effort depth (shared.ts). effort alone won't emit
    // thinking blocks — `thinking` must be enabled for reasoning to stream.
    thinking: thinkingFromLevel(args.settings.level),
    effort: effortFromLevel(args.settings.level),
    // Gate every tool through our PreToolUse hook; bypassPermissions so the SDK's
    // own (unreliable) permission path doesn't shadow it (ADR 0058 P4).
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    hooks: { PreToolUse: [{ hooks: [makePreToolUseHook(gate)] }] },
    // Honour the agent's tool whitelist (Claude Code subagent `tools:` field).
    ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
    ...(args.disabledTools ? { disallowedTools: args.disabledTools } : {}),
    ...(sdkModel ? { model: sdkModel } : {}),
    ...(args.cwd ? { cwd: args.cwd } : {}),
    ...(args.sdkSessionId ? { resume: args.sdkSessionId } : {}),
    ...(Object.keys(allServers).length > 0 ? { mcpServers: allServers } : {}),
    ...(args.abortController ? { abortController: args.abortController } : {}),
    env: buildSdkEnv(cred),
    // Packaged builds: point at the bundled native binary (ADR 0058 P3); dev leaves
    // it undefined so the SDK auto-discovers from the pnpm store.
    ...(claudeBinary ? { pathToClaudeCodeExecutable: claudeBinary } : {}),
  }

  log.info('chat stream request (claude-sdk)', {
    runtime: 'claude-sdk',
    sessionId: args.sessionId,
    model: args.settings.modelId,
    account: account.id,
    accountLabel: account.label,
    resume: !!args.sdkSessionId,
    nativeBinary: !!claudeBinary,
    historyTurns: args.history.length,
  })

  // Persist every main-agent TodoWrite as the session's current checklist — the
  // SDK-path equivalent of the Pi tool layer's todoSink (ADR 0069). Without it the
  // banner/Plan tab can only fall back to the transcript snapshot and a user edit
  // has no authoritative list to write to.
  const todoSessionId = args.sessionId
  const adapter = createClaudeEventAdapter(cb, {
    ...(todoSessionId
      ? {
          onTodos: (todos: TodoItem[]) => {
            void updateSessionMetadata(todoSessionId, { todos })
          },
        }
      : {}),
  })
  // ── Background work: keep the CLI session alive until it settles ────────────
  //
  // The CLI holds the turn open for background subagents/shells and wakes the
  // model when one finishes (`system/task_notification`). That only works while
  // its stdin is open, so we decide when to close: on the turn's `result` we let
  // the session end ONLY when no background task is live; otherwise we keep
  // consuming and the model's woken continuation streams into this same turn.
  //
  // `background_tasks_changed` is a LEVEL signal (replace the set wholesale); the
  // task_started/task_notification bookends are the fallback for a CLI that
  // doesn't emit the level. The set starts empty because this query owns a fresh
  // CLI process.
  // id → task_type. We only PARK the turn for work the user is actually waiting on
  // (a subagent, a shell, a workflow). Ambient/housekeeping tasks the CLI runs on
  // its own ('monitor', anything unknown) must never hold a turn open — that would
  // add the wait to EVERY turn. Unknown types therefore degrade to the old
  // behaviour (end the turn) rather than to a hang.
  const liveBackground = new Map<string, string>()
  const WAITABLE_TASK_TYPES = new Set(['subagent', 'shell', 'workflow', 'agent', 'bash'])
  const waitingCount = (): number => {
    let n = 0
    for (const type of liveBackground.values()) if (WAITABLE_TASK_TYPES.has(type)) n += 1
    return n
  }
  let closed = false
  // Parked = the turn's result already arrived and we are only still here for
  // background work.
  let parked = false
  let waitTimer: NodeJS.Timeout | undefined
  let graceTimer: NodeJS.Timeout | undefined
  const closeInput = (reason: string): void => {
    if (closed) return
    closed = true
    if (waitTimer) clearTimeout(waitTimer)
    if (graceTimer) clearTimeout(graceTimer)
    log.info('claude-sdk closing input', { sessionId: args.sessionId, reason })
    prompt.close()
  }
  // Hard cap so a wedged background task can't hold the turn (and the session
  // lock) forever. Honours the per-turn wallclock budget when the caller set one.
  const waitCapMs = args.budget?.maxWallclockMs ?? DEFAULT_BACKGROUND_WAIT_MS
  const armWaitCap = (): void => {
    if (waitTimer || closed) return
    waitTimer = setTimeout(() => closeInput('background wait cap reached'), waitCapMs)
  }
  // Every parked task settled but the CLI didn't wake the model (it skips ambient
  // tasks, and a failed task may produce no continuation). Give it a short grace
  // window — any message cancels it — then end the turn instead of sitting until
  // the cap.
  const armGrace = (): void => {
    if (graceTimer || closed || !parked || waitingCount() > 0) return
    graceTimer = setTimeout(
      () => closeInput('background settled, no continuation'),
      BACKGROUND_GRACE_MS,
    )
  }
  const onAbort = (): void => closeInput('aborted')
  args.abortController?.signal.addEventListener('abort', onAbort, { once: true })

  const trackBackground = (msg: SDKMessage): void => {
    if (msg.type !== 'system') return
    const m = msg as {
      subtype?: string
      tasks?: { task_id: string; task_type?: string }[]
      task_id?: string
      task_type?: string
      subagent_type?: string
      state?: string
    }
    switch (m.subtype) {
      case 'background_tasks_changed':
        liveBackground.clear()
        for (const t of m.tasks ?? []) liveBackground.set(t.task_id, t.task_type ?? 'unknown')
        break
      case 'task_started':
        // A Task-tool subagent may arrive without task_type; subagent_type says it.
        if (m.task_id) {
          liveBackground.set(m.task_id, m.task_type ?? (m.subagent_type ? 'subagent' : 'unknown'))
        }
        break
      case 'task_notification':
        if (m.task_id) liveBackground.delete(m.task_id)
        break
      case 'session_state_changed':
        // Authoritative turn-over signal: fires once the held-back result has
        // flushed AND the background loop has exited — nothing left to wait for.
        if (m.state === 'idle') closeInput('session idle')
        break
      default:
        break
    }
  }

  try {
    for await (const msg of query({ prompt: prompt.stream, options })) {
      // Any message is activity: the CLI is alive and working, so a pending
      // "settled but nothing followed" grace window no longer applies.
      if (graceTimer) {
        clearTimeout(graceTimer)
        graceTimer = undefined
      }
      adapter.handle(msg)
      trackBackground(msg)
      if (msg.type === 'result') {
        const waiting = waitingCount()
        if (waiting === 0) closeInput('turn complete')
        else {
          parked = true
          log.info('claude-sdk turn parked on background work', {
            sessionId: args.sessionId,
            tasks: waiting,
            capMs: waitCapMs,
          })
          armWaitCap()
        }
      }
      armGrace()
    }
  } catch (err) {
    throw mapClaudeErrorToRpc(err)
  } finally {
    // Never leave the generator parked (it would keep the CLI process alive) or a
    // timer pending, whichever way this turn ended.
    closeInput('turn ended')
    args.abortController?.signal.removeEventListener('abort', onAbort)
  }

  // A mid-stream abort surfaces as CANCELED so send-message routes it through the
  // cancel path (persist the partial reply flagged canceled) — same as the Pi path.
  if (args.abortController?.signal.aborted) {
    throw new RpcError(-32023, 'CANCELED')
  }

  const acc = adapter.result()
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
  const systemPromptLen = (args.systemPrompt ?? '').length
  // Turn-prompt riders (style / plan / checklist / todo nudge) are instructions the
  // model receives every turn even though they don't live in `append` on this path
  // — count them here so the gauge doesn't under-report what we actually send.
  const ridersLen =
    (stylePrompt?.length ?? 0) +
    (inPlanMode ? PLAN_MODE_PROMPT.length : 0) +
    (args.sessionChecklist?.length ?? 0) +
    (todoAllowed ? TODO_USAGE_PROMPT.length : 0) +
    BACKGROUND_TURN_PROMPT.length
  const instructionsLen =
    Math.max(
      0,
      (append?.length ?? 0) - systemPromptLen - memoryFilesLen - customAgentsLen - skillsLen,
    ) + ridersLen
  // Transcript the SDK context holds: kept turns from the compaction cut onward (or
  // the whole transcript when uncompacted) + the summary — measured TEXT-ONLY via
  // renderHistoryPrefix (exactly what we seed the SDK with). We must NOT
  // JSON.stringify the raw SessionMessages: their `steps[]`/`parts[]` carry UI-only
  // tool I/O (full file contents, terminal output) that is NEVER replayed to the
  // model, which would inflate the gauge far past what is sent and never shrink on
  // /compact. Mirrors the Pi path's historyToAgentMessages estimate.
  const historyLen =
    renderHistoryPrefix(args.history, args.compaction).length + args.pendingText.length
  const contextChars: ContextChars = {
    systemPrompt: systemPromptLen,
    instructions: instructionsLen,
    customAgents: customAgentsLen,
    skills: skillsLen,
    memoryFiles: memoryFilesLen,
    history: historyLen,
    ...(items?.memoryFilesList.length ? { memoryFilesList: items.memoryFilesList } : {}),
    ...(items?.customAgentsList.length ? { customAgentsList: items.customAgentsList } : {}),
    ...(items?.skillsList.length ? { skillsList: items.skillsList } : {}),
  }

  return {
    text: acc.text,
    modelUsed: acc.modelUsed || args.settings.modelId,
    usage: {
      input_tokens: acc.inputTokens,
      output_tokens: acc.outputTokens,
      cache_read_tokens: acc.cacheReadTokens,
      cache_creation_tokens: acc.cacheWriteTokens,
    },
    stopReason: acc.stopReason,
    contextChars,
    // Persisted by the caller so the next turn resumes this SDK session.
    ...(acc.sdkSessionId ? { sdkSessionId: acc.sdkSessionId } : {}),
    ...(acc.errorMessage !== undefined ? { errorMessage: acc.errorMessage } : {}),
  }
}
