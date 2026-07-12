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
} from '../../types/shared.js'
import { makeBeforeToolCall, withTurnBudget, type BeforeToolCall } from '../permission.js'
import { buildRulesPrompt, extractTurnPaths } from '../../rules/inject.js'
import { buildStylePrompt } from '../../style/styles.js'
import { createClaudeEventAdapter } from './event-adapter.js'
import { buildApiSdkServers } from './api-sdk-server.js'
import { buildSourceToolsSdkServer } from './source-sdk-server.js'
import { resolveClaudeBinary } from './binary.js'
import {
  buildSdkEnv,
  commitAttribution,
  effortFromLevel,
  mapClaudeErrorToRpc,
  thinkingFromLevel,
  toSdkMcpServers,
  toSdkModel,
} from './shared.js'

// Plan-mode nudge (mirrors the Pi path). The gate blocks all writes/exec in plan
// mode, so tell the model to investigate read-only then present its plan via the
// SDK's native ExitPlanMode tool instead of attempting edits.
const PLAN_MODE_PROMPT = `<plan-mode>
You are in PLAN MODE. Use ONLY read-only tools (Read, Grep, Glob) to investigate — every write or shell command is blocked. When you have a concrete approach, call the \`ExitPlanMode\` tool with your plan as markdown (a short rationale + numbered steps) and stop for the user's approval. Do not attempt edits.
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

// Build the SDK prompt: the plain string when nothing usable is attached, else a
// one-shot streaming generator carrying text + file/document/image blocks. All ride
// with the CURRENT turn; prior-turn attachments persist via the SDK's own resume
// store, so there's no re-feed to do here.
function buildClaudePrompt(
  text: string,
  attachments: SessionAttachment[] | undefined,
): string | AsyncIterable<SDKUserMessage> {
  const list = attachments ?? []
  const images = list.map(toClaudeImageBlock).filter((b): b is ClaudeImageBlock => b !== null)
  const docs = list.map(toClaudeDocBlock).filter((b): b is ClaudeDocBlock => b !== null)
  const files = list.map(toClaudeFileTextBlock).filter((b): b is ClaudeTextBlock => b !== null)
  if (images.length === 0 && docs.length === 0 && files.length === 0) return text
  const content: ClaudePromptBlock[] = []
  if (text) content.push({ type: 'text', text })
  content.push(...files, ...docs, ...images)
  return (async function* (): AsyncGenerator<SDKUserMessage> {
    yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }
  })()
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
  const appendParts = [
    args.systemPrompt,
    args.systemPromptAppend,
    rulesPrompt,
    inPlanMode ? PLAN_MODE_PROMPT : undefined,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0)
  const append = appendParts.length > 0 ? appendParts.join('\n\n') : undefined

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

  // Attachments (images / text files) need the streaming-input block form — the
  // string prompt can't carry them. Returns the plain string when nothing usable
  // is attached, so the common text-only turn is unchanged.
  const prompt = buildClaudePrompt(promptText, args.pendingAttachments)

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
  const allServers = {
    ...(mcpServers ?? {}),
    ...apiServers,
    // source_* conversational setup tools → mcp__awog__source_*.
    awog: buildSourceToolsSdkServer(),
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

  const adapter = createClaudeEventAdapter(cb)
  try {
    for await (const msg of query({ prompt, options })) {
      adapter.handle(msg)
    }
  } catch (err) {
    throw mapClaudeErrorToRpc(err)
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
  const instructionsLen = Math.max(
    0,
    (append?.length ?? 0) - systemPromptLen - memoryFilesLen - customAgentsLen - skillsLen,
  )
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
