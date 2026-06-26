import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import {
  runStream,
  registerAborter,
  unregisterAborter,
  type RunStreamResult,
} from '../sessions/runner.js'
import { appendMessage, appendEvent, loadSession } from '../sessions/store.js'
import { beginSteerTurn, endSteerTurn, drainSteer } from '../sessions/steering.js'
import { buildLinkedTaskBlock } from '../sessions/linked-task.js'
import { captureSnapshot } from '../sessions/snapshots.js'
import { loadProject } from '../projects/store.js'
import {
  parkPermissionRequest,
  rejectPermissionRequest,
} from '../sessions/permissions.js'
import { parkQuestionRequest, rejectQuestionRequest } from '../sessions/questions.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { liftTurnSignalListenerCap } from '../runtime/turn-signal.js'
import { listServers as listMcpServers } from '../mcp/store.js'
import { loadAgent, listAgents } from '../agents/store.js'
import { listSkills } from '../skills/store.js'
import { expandSecrets } from '../mcp/secrets.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import { readFile as fsReadFile } from 'node:fs/promises'
import type {
  AskUserQuestionFn,
  CanUseTool,
  McpServersConfig,
} from '../runtime/permission-types.js'
import type {
  ContextItemSize,
  SessionAttachment,
  SessionMessage,
  SessionMessagePart,
  SessionSettings,
  SessionStep,
} from '../types/shared.js'

const SessionMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(['user', 'agent', 'system']),
    text: z.string(),
    at: z.string(),
  })
  .passthrough()

// Pre-process: legacy sessions saved 'standard' before we adopted Claude
// Code's effort vocabulary. Map it to 'low' so old JSONL still parses.
const ThinkingLevelSchema = z.preprocess(
  (v) => (v === 'standard' ? 'low' : v),
  z.enum(['low', 'medium', 'high', 'extra-high', 'max']),
)

const SessionSettingsSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']),
  modelId: z.string(),
  level: ThinkingLevelSchema,
  mode: z.enum(['ask', 'accept-edits', 'plan', 'execute']),
  accountId: z.string().optional(),
  // Response style (ADR 0046) — built-in style id + no-markdown modifier.
  responseStyle: z.string().optional(),
  responseStyleNoMarkdown: z.boolean().optional(),
})

// User attachment on the outgoing message (L1: untrusted UI payload). Image
// attachments carry an inline base64 `data:` URL in `url`; the runtime rebuilds
// them into image content blocks for the model (buildContext). Text-based files
// (and large pasted text) carry their UTF-8 content in `preview`, delivered to
// the model as a delimited text block. Binary files carry neither and are
// persisted for display only.
const SessionAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['file', 'image']),
  size: z.string().optional(),
  mime: z.string().optional(),
  url: z.string().optional(),
  // Bound the text payload so a hostile/oversized IPC message can't blow memory.
  // The UI caps content at ~256k chars; this leaves generous headroom.
  preview: z.string().max(2_000_000).optional(),
  width: z.number().optional(),
  height: z.number().optional(),
})

// Cap the count to bound message bloat; per-image size is gated downstream in
// buildContext (oversized images are dropped for the model, not rejected here).
const MAX_ATTACHMENTS = 20

const Params = z.object({
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  // May be empty when the turn carries only image attachments — the
  // text-or-attachments invariant is enforced by the object-level .refine below.
  text: z.string(),
  attachments: z.array(SessionAttachmentSchema).max(MAX_ATTACHMENTS).optional(),
  history: z.array(SessionMessageSchema).default([]),
  settings: SessionSettingsSchema,
  systemPrompt: z.string().optional(),
  // Optional project linkage. When present, sidecar resolves the project's
  // on-disk path and passes it as the runtime tools' fs root so Read/Bash/Edit
  // operate against the user's repo instead of process.cwd().
  projectId: z.string().optional(),
  // Session-scoped tool denylist (Claude Code tool names). Removes these tools
  // from the runtime tool set so the model never even sees them.
  disabledTools: z.array(z.string()).optional(),
  // Session-scoped MCP server whitelist. `undefined` = legacy behaviour: use
  // all globally-enabled servers. `[]` = explicitly none. `[ids]` = only these
  // (intersected with the globally-enabled set).
  mcpServerIds: z.array(z.string()).optional(),
  // Discuss link (ADR 0055): the task this session discusses. When set, a
  // <linked_task> block (the task's status + per-phase output) is injected into
  // this turn's systemPromptAppend so the agent can reason about the results.
  aboutTaskId: z.string().optional(),
  // Active compaction checkpoint (ADR 0047), forwarded by the UI alongside
  // `history` (same trust model). When present, the runtime feeds the model the
  // summary + messages from `firstKeptMessageId` onward instead of full history.
  compaction: z
    .object({
      summary: z.string(),
      firstKeptMessageId: z.string(),
      tokensBefore: z.number(),
      at: z.string(),
    })
    .optional(),
  // Active agent for this turn. Identifies the AGENT.md by (id, source,
  // projectId?) tuple because the same slug can exist in multiple tiers.
  // When present + resolves to an agent with non-empty systemPrompt, that
  // prompt replaces `params.systemPrompt` for this turn. ADR 0015.
  agent: z
    .object({
      id: z.string().min(1).max(64),
      source: z.enum(['global', 'project']),
      projectId: z.string().min(1).max(64).optional(),
    })
    .optional(),
})
  // A turn must carry something the model can act on: composer text, an image
  // attachment, or a text/pasted-text attachment (content in `preview`). A
  // file-only message with no readable content has nothing to act on. Fail-fast
  // at the boundary — the UI guards too, but never trust the IPC payload.
  .refine(
    (p) =>
      p.text.trim().length > 0 ||
      (p.attachments?.some(
        (a) =>
          (a.type === 'image' && !!a.url) ||
          (a.type === 'file' && !!a.preview && a.preview.trim().length > 0),
      ) ??
        false),
    { message: 'a message must have text, an image, or a text attachment' },
  )

// exactOptionalPropertyTypes: zod's .optional() yields `T | undefined`, but
// SessionSettings.accountId is presence-only (`accountId?: string`). Rebuild
// with explicit spread so optional fields are only added when defined.
function toSessionSettings(parsed: z.infer<typeof SessionSettingsSchema>): SessionSettings {
  const base: SessionSettings = {
    provider: parsed.provider,
    modelId: parsed.modelId,
    level: parsed.level,
    mode: parsed.mode,
  }
  if (parsed.accountId !== undefined) base.accountId = parsed.accountId
  if (parsed.responseStyle !== undefined) base.responseStyle = parsed.responseStyle
  if (parsed.responseStyleNoMarkdown !== undefined) {
    base.responseStyleNoMarkdown = parsed.responseStyleNoMarkdown
  }
  return base
}

// Same exactOptionalPropertyTypes dance as toSessionSettings: only attach
// optional fields when defined so the result is a clean SessionAttachment.
function toSessionAttachment(a: z.infer<typeof SessionAttachmentSchema>): SessionAttachment {
  const base: SessionAttachment = { id: a.id, name: a.name, type: a.type }
  if (a.size !== undefined) base.size = a.size
  if (a.mime !== undefined) base.mime = a.mime
  if (a.url !== undefined) base.url = a.url
  if (a.preview !== undefined) base.preview = a.preview
  if (a.width !== undefined) base.width = a.width
  if (a.height !== undefined) base.height = a.height
  return base
}

// Claude-Code-style bulk load. Like the CLI, we preload a compact catalogue of
// what is available — the project's memory files (CLAUDE.md / AGENTS.md), the
// in-scope custom agents, and the in-scope skills — so the model knows it can
// invoke them. Each section is wrapped in a labelled block and folded into the
// turn's systemPromptAppend; per-section char sizes + itemised lists are
// returned so the runtime can report them in contextChars (UI usage panel).
//
// Char counts are measured on the EXACT injected block text so the breakdown
// matches what the model actually receives.
const CONTEXT_FILE_NAMES = ['CLAUDE.md', 'AGENTS.md'] as const
// Cap per memory file so a giant CLAUDE.md can't blow the prompt; the breakdown
// reflects the truncated content actually injected.
const MAX_MEMORY_FILE_CHARS = 64_000
// Compact one-line description for the agent/skill catalogue (the model reads
// name + intent, not the full body — it loads those on demand).
function compactLine(name: string, description: string): string {
  const desc = description.replace(/\s+/g, ' ').trim().slice(0, 200)
  return desc ? `- ${name}: ${desc}` : `- ${name}`
}

interface BulkLoadResult {
  // Appended to systemPromptAppend (joined blocks), or undefined when empty.
  block?: string
  memoryFilesChars: number
  customAgentsChars: number
  skillsChars: number
  memoryFilesList: ContextItemSize[]
  customAgentsList: ContextItemSize[]
  skillsList: ContextItemSize[]
}

async function buildBulkLoad(
  projectId: string | undefined,
  cwd: string | undefined,
): Promise<BulkLoadResult> {
  const result: BulkLoadResult = {
    memoryFilesChars: 0,
    customAgentsChars: 0,
    skillsChars: 0,
    memoryFilesList: [],
    customAgentsList: [],
    skillsList: [],
  }
  const blocks: string[] = []

  // Memory files — read project-root CLAUDE.md / AGENTS.md (when a project is
  // linked). Path is gated by assertInsideWorkspace (security invariant #2);
  // missing files are skipped. No project → nothing to bulk-load here.
  if (cwd) {
    const fileBlocks: string[] = []
    for (const name of CONTEXT_FILE_NAMES) {
      let abs: string
      try {
        abs = assertInsideWorkspace(cwd, name)
      } catch {
        continue
      }
      let content: string
      try {
        // eslint-disable-next-line no-await-in-loop
        content = await fsReadFile(abs, 'utf8')
      } catch {
        continue // missing / unreadable → skip
      }
      const trimmed = content.slice(0, MAX_MEMORY_FILE_CHARS)
      const fileBlock = `<file path="${name}">\n${trimmed}\n</file>`
      fileBlocks.push(fileBlock)
      result.memoryFilesList.push({ label: name, chars: fileBlock.length })
    }
    if (fileBlocks.length > 0) {
      const block = `<project_context_files>\n${fileBlocks.join('\n')}\n</project_context_files>`
      blocks.push(block)
      result.memoryFilesChars = block.length
    }
  }

  // Custom agents — name + compact description of the in-scope agents (Task
  // tool's subagent menu). Best-effort: a listing failure just omits the block.
  const projectIds = projectId ? [projectId] : []
  try {
    const { agents } = await listAgents(projectIds)
    if (agents.length > 0) {
      const lines = agents.map((a) => {
        const line = compactLine(a.name, a.description)
        result.customAgentsList.push({ label: a.name, chars: line.length })
        return line
      })
      const block = `<available_agents>\n${lines.join('\n')}\n</available_agents>`
      blocks.push(block)
      result.customAgentsChars = block.length
    }
  } catch (err) {
    log.warn('failed to list agents for bulk load', {
      err: err instanceof Error ? err.message : String(err),
    })
  }

  // Skills — name + compact description of the in-scope skills.
  try {
    const { skills } = await listSkills(projectIds)
    if (skills.length > 0) {
      const lines = skills.map((s) => {
        const line = compactLine(s.name, s.description)
        result.skillsList.push({ label: s.name, chars: line.length })
        return line
      })
      const block = `<available_skills>\n${lines.join('\n')}\n</available_skills>`
      blocks.push(block)
      result.skillsChars = block.length
    }
  } catch (err) {
    log.warn('failed to list skills for bulk load', {
      err: err instanceof Error ? err.message : String(err),
    })
  }

  if (blocks.length > 0) result.block = blocks.join('\n\n')
  return result
}

register('sessions.sendMessage', async (raw) => {
  const params = Params.parse(raw)

  // Normalise attachments once (exactOptionalPropertyTypes). Reused for both the
  // persisted user message and the runtime image-content rebuild.
  const attachments = params.attachments?.map(toSessionAttachment)

  // Resume context (ADR 0029): the runtime has no opaque session id — it rebuilds
  // the model context from `history` every turn. The reference `ui` snapshots its
  // in-memory transcript into `params.history`; the rebuilt `ui-next` cannot (its
  // display model keeps only render blocks, no canonical per-message text), so it
  // sends an empty array. When history is empty, fold it from the JSONL transcript
  // — the source of truth — so a follow-up turn still sees the prior conversation
  // instead of starting blank. Loaded BEFORE the current user message is persisted
  // below, so it carries ONLY prior turns (pendingText drives this one). A brand-
  // new session (no file) folds to []. A non-empty `params.history` is honoured
  // unchanged (reference `ui`) — backward compatible.
  let historyForRun = params.history as unknown as SessionMessage[]
  if (historyForRun.length === 0) {
    try {
      const loaded = await loadSession(params.sessionId)
      if (loaded && loaded.messages.length > 0) historyForRun = loaded.messages
    } catch (err) {
      log.warn('failed to fold session history for resume', {
        sessionId: params.sessionId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // One AbortController per turn. sessions.cancel resolves it by messageId.
  const abortController = new AbortController()
  // This turn signal fans out to undici (per LLM request), parallel tool calls,
  // and subagents — lift Node's 10-listener cap to silence the false-positive
  // MaxListenersExceededWarning (see runtime/turn-signal.ts).
  liftTurnSignalListenerCap(abortController.signal)
  registerAborter(params.sessionId, params.messageId, abortController)
  // Open the steer channel for this turn so sessions.steer can enqueue mid-turn
  // instructions; torn down in the finally below. Keyed by the assistant
  // messageId, same as the aborter registry.
  beginSteerTurn(params.messageId)

  // Resolve cwd from project, if linked. Best-effort: missing project → no
  // cwd (the runtime falls back to process.cwd()). Don't error the chat for a
  // stale projectId.
  let cwd: string | undefined
  if (params.projectId) {
    try {
      const project = await loadProject(params.projectId)
      if (project?.path) cwd = project.path
    } catch (err) {
      log.warn('failed to resolve project cwd', {
        projectId: params.projectId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Resolve the active agent (if any). When found:
  //   - `agent.systemPrompt` REPLACES `params.systemPrompt` (ADR 0015)
  //   - `agent.tools` (Claude Code subagent whitelist) → runtime allowedTools
  //   - `agent.mcpServerIds` → per-agent MCP whitelist
  // Missing / unparseable agent → fall back to the caller's prompt + full toolset.
  let resolvedSystemPrompt = params.systemPrompt
  let resolvedAllowedTools: string[] | undefined
  let resolvedAgentMcpIds: string[] | undefined
  if (params.agent) {
    try {
      const agent = await loadAgent(
        params.agent.id,
        params.agent.source,
        params.agent.projectId,
      )
      if (agent?.systemPrompt) resolvedSystemPrompt = agent.systemPrompt
      if (agent?.tools && agent.tools.length > 0) resolvedAllowedTools = agent.tools
      if (agent?.mcpServerIds && agent.mcpServerIds.length > 0) {
        resolvedAgentMcpIds = agent.mcpServerIds
      }
    } catch (err) {
      log.warn('failed to load agent for runtime injection', {
        agent: params.agent,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Build the resolved MCP server map for the runtime. ADR 0029 §4: the runtime
  // bridges these to in-process Pi tools. We only forward enabled stdio/http
  // servers — disabled entries shouldn't surface tools to the model.
  // Per-session whitelist (params.mcpServerIds) further narrows the set:
  //   undefined → all enabled (legacy)
  //   []        → none
  //   [ids]     → only those (∩ enabled)
  let mcpServersForRuntime: McpServersConfig | undefined
  // Track which servers actually made it through so we can build a matching
  // system-prompt nudge (only when user explicitly whitelisted).
  const attachedMcpServers: { id: string; name: string }[] = []
  try {
    const all = await listMcpServers()
    // Two whitelist layers (ADR 0016): session-level (params.mcpServerIds) and
    // agent-level (resolvedAgentMcpIds). Intersect both when present so the
    // narrower scope wins. undefined = "no restriction at this layer".
    const sessionWhitelist =
      params.mcpServerIds !== undefined ? new Set(params.mcpServerIds) : null
    const agentWhitelist = resolvedAgentMcpIds ? new Set(resolvedAgentMcpIds) : null
    const entries: [string, McpServersConfig[string]][] = []
    for (const s of all) {
      if (!s.enabled) continue
      if (sessionWhitelist && !sessionWhitelist.has(s.id)) continue
      if (agentWhitelist && !agentWhitelist.has(s.id)) continue
      let cfg: McpServersConfig[string]
      if (s.transport === 'stdio') {
        if (!s.command) continue
        // Expand `secret:KEY` placeholders in env against OS keychain — ADR 0018.
        // The runtime passes plaintext env to the in-process MCP child. The
        // expansion happens fresh per turn so a re-saved keychain value
        // takes effect on the next message.
        // eslint-disable-next-line no-await-in-loop
        const expandedEnv = await expandSecrets(s.id, s.env)
        cfg = {
          type: 'stdio',
          command: s.command,
          ...(s.args ? { args: s.args } : {}),
          ...(Object.keys(expandedEnv).length > 0 ? { env: expandedEnv } : {}),
          // Per-server handshake budget — `npx -y` cold starts can exceed the
          // bridge default; honour the user's configured timeout.
          timeoutMs: s.timeoutMs,
        }
      } else if (s.transport === 'http') {
        if (!s.url) continue
        // eslint-disable-next-line no-await-in-loop
        const expandedHeaders = await expandSecrets(s.id, s.headers)
        cfg = {
          type: 'http',
          url: s.url,
          ...(Object.keys(expandedHeaders).length > 0 ? { headers: expandedHeaders } : {}),
          timeoutMs: s.timeoutMs,
        }
      } else {
        // sse not supported pha 2
        continue
      }
      entries.push([s.id, cfg])
      attachedMcpServers.push({ id: s.id, name: s.name })
    }
    if (entries.length > 0) {
      mcpServersForRuntime = Object.fromEntries(entries)
    }
  } catch (err) {
    log.warn('failed to list mcp servers for session', {
      err: err instanceof Error ? err.message : String(err),
    })
  }

  // System-prompt nudge — only when user EXPLICITLY attached MCP servers
  // (params.mcpServerIds set OR agent has mcpServerIds) AND at least one
  // server is reachable. Without this, Claude often falls back to CLI tools
  // (`gh`, `gcloud`, `kubectl`) because they're heavily represented in
  // training data. Forwarded to subagents so Task-spawned children honour it.
  let systemPromptAppend: string | undefined
  const hasExplicitWhitelist =
    params.mcpServerIds !== undefined || resolvedAgentMcpIds !== undefined
  if (hasExplicitWhitelist && attachedMcpServers.length > 0) {
    const lines = attachedMcpServers.map((s) => `- mcp__${s.id}__* (${s.name})`).join('\n')
    systemPromptAppend = `<mcp-preference>
The user explicitly attached the following MCP servers to this session:
${lines}

When you need to interact with these services, **prefer the corresponding \`mcp__<serverId>__<toolName>\` tools** over CLI equivalents (\`gh\`, \`gcloud\`, \`kubectl\`, \`aws\`, raw HTTP) or shell scripting. The MCP tools were explicitly enabled for this purpose.

When delegating work via the Task tool, the subagent inherits these MCP servers automatically — instruct it in the prompt to use the same \`mcp__<serverId>__<toolName>\` tools rather than CLI alternatives.
</mcp-preference>`
  }

  // Claude-Code-style bulk load (memory files / available agents / available
  // skills). Folded into systemPromptAppend so the model sees the catalogue; the
  // per-section char sizes ride along to the runtime for the usage-panel
  // breakdown. Best-effort — buildBulkLoad never throws.
  const bulkLoad = await buildBulkLoad(params.projectId, cwd)
  if (bulkLoad.block) {
    systemPromptAppend = systemPromptAppend
      ? `${systemPromptAppend}\n\n${bulkLoad.block}`
      : bulkLoad.block
  }

  // Discuss link (ADR 0055): when this session discusses a task, inject the task's
  // results as a <linked_task> block. Rebuilt each turn so a running task's context
  // stays fresh. Best-effort — a missing/deleted task yields no block.
  if (params.aboutTaskId) {
    const linkedTask = await buildLinkedTaskBlock(params.aboutTaskId)
    if (linkedTask) {
      systemPromptAppend = systemPromptAppend
        ? `${systemPromptAppend}\n\n${linkedTask}`
        : linkedTask
    }
  }

  // Total ms this turn spends PARKED on human input (permission prompt or
  // AskUserQuestion answer). Measured around the park awaits below and persisted
  // on the agent message so the UI can subtract it from the displayed elapsed
  // (a turn shouldn't read as "8m" because the user took 8m to answer).
  let waitingMs = 0

  // Track which permission requestIds belong to this turn so we can reject
  // them on abort/cancel (rather than leaking parked promises forever).
  const turnRequestIds = new Set<string>()

  const canUseTool: CanUseTool = async (toolName, input, opts) => {
    const requestId = `pr_${randomBytes(8).toString('hex')}`
    turnRequestIds.add(requestId)

    const payload: Record<string, unknown> = {
      sessionId: params.sessionId,
      messageId: params.messageId,
      requestId,
      toolName,
      input,
      toolUseID: opts.toolUseID,
    }
    if (opts.title) payload.promptSentence = opts.title
    if (opts.displayName) payload.displayName = opts.displayName
    if (opts.description) payload.description = opts.description
    if (opts.decisionReason) payload.decisionReason = opts.decisionReason
    if (opts.blockedPath) payload.blockedPath = opts.blockedPath
    if (opts.suggestions && opts.suggestions.length > 0) {
      payload.suggestions = opts.suggestions
    }

    // Hand back a promise that resolves when sessions.permission lands the
    // user's choice. parkPermissionRequest owns the Map of in-flight prompts.
    const pending = parkPermissionRequest(requestId, opts.suggestions ?? [])
    emit('session.permission-request', payload)

    const parkedAt = Date.now()
    try {
      return await pending
    } finally {
      waitingMs += Date.now() - parkedAt
      turnRequestIds.delete(requestId)
    }
  }

  // Track open AskUserQuestion tool-call ids so abort/cancel can unwind them.
  const turnQuestionIds = new Set<string>()

  // AskUserQuestion handler. Parks on the tool-call id (which is also the step
  // id the UI rendered from the session.step event, and the answerQuestion
  // requestId) until the user submits answers. No separate event is emitted —
  // the question already reached the UI as the kind:'question' step.
  const askUserQuestion: AskUserQuestionFn = async (toolCallId) => {
    turnQuestionIds.add(toolCallId)
    const pending = parkQuestionRequest(toolCallId)
    const parkedAt = Date.now()
    try {
      return await pending
    } finally {
      waitingMs += Date.now() - parkedAt
      turnQuestionIds.delete(toolCallId)
    }
  }

  // If the user aborts mid-prompt, reject every parked permission for this
  // turn so the promise chain unwinds cleanly. The runner's `abortController`
  // already short-circuits the model loop; this cleans up the parked promises
  // we own here.
  const onAbort = () => {
    for (const id of turnRequestIds) {
      rejectPermissionRequest(id, 'User canceled the request')
    }
    turnRequestIds.clear()
    // Unwind any open AskUserQuestion (resolves as empty answers) so the tool's
    // execute() returns a "canceled" result instead of hanging.
    for (const id of turnQuestionIds) {
      rejectQuestionRequest(id)
    }
    turnQuestionIds.clear()
  }
  abortController.signal.addEventListener('abort', onAbort)

  // Accumulate the streamed text + steps so we can persist the assistant turn at
  // ANY exit — success, cancel, error, or a hard process kill mid-stream. A
  // step's `running → done` transition arrives as a second event with the same
  // id; keying a Map by id upserts in place while preserving first-seen order.
  // Steps are stored flat (subagent children keep their `parentId`); the UI
  // re-nests on hydrate.
  let accumulatedText = ''
  const collectedSteps = new Map<string, SessionStep>()
  // High-water marks for the byte-minimal progress deltas (see persistProgress):
  // each throttled write appends only the text + steps added since the last one.
  let persistedTextLen = 0
  let persistedStepCount = 0

  // Ordered timeline parts (ADR 0032): reply-text runs interleaved with steps in
  // arrival order. This is the minimalist-agent `applyEvent` reducer — a tool/step
  // pushes a part (closing the current text run so the next text delta opens a
  // fresh run). Steps stay FLAT here (subagent children carry `parentId`), exactly
  // like `steps`; the UI re-nests parts by parentId on hydrate. No offsets.
  const parts: SessionMessagePart[] = []
  const appendTextPart = (delta: string): void => {
    const last = parts[parts.length - 1]
    if (last && last.kind === 'text') last.text += delta
    else parts.push({ kind: 'text', text: delta })
  }
  const upsertStepPart = (step: SessionStep): void => {
    // Merge a repeat (running → done, thinking re-emits) in place, else push a new
    // part — pushing a non-text part is what splits the reply text around it.
    const existing = parts.find((p) => p.kind !== 'text' && p.id === step.id)
    if (existing) Object.assign(existing, step)
    else parts.push(step)
  }

  // Persist the USER message up front, before the model runs. Pre-fix it was
  // written only after the turn resolved, so a cancel / crash mid-reply lost it
  // entirely. appendMessage re-folds the file and skips if the session isn't
  // created yet (new-session race — the UI's create RPC has landed by send time).
  try {
    await appendMessage(params.sessionId, {
      id: `msg_u_${randomBytes(8).toString('hex')}`,
      role: 'user',
      text: params.text,
      at: new Date().toISOString(),
      // Persist attachments so a JSONL reload keeps the image preview AND so the
      // next turn's resume rebuilds the image content block (image lives with
      // the session context, not just the turn that sent it).
      ...(attachments && attachments.length ? { attachments } : {}),
    })
  } catch (err) {
    log.warn('failed to persist user message', {
      sessionId: params.sessionId,
      err: err instanceof Error ? err.message : String(err),
    })
  }

  // Append the authoritative FINAL snapshot of the assistant turn (full text +
  // steps + parts + usage). Upserts by message id over any mid-stream
  // `message.progress` deltas — last write wins. Called once per turn at every
  // exit (success, cancel, error). appendEvent has no re-fold guard; if the
  // session was deleted mid-turn the fold tombstones this anyway.
  const persistAgent = async (opts: { result?: RunStreamResult }) => {
    const steps = [...collectedSteps.values()]
    const message: SessionMessage = {
      id: params.messageId,
      role: 'agent',
      text: opts.result?.text ?? accumulatedText,
      at: new Date().toISOString(),
      ...(steps.length > 0 ? { steps } : {}),
      // Ordered timeline (ADR 0032). Authoritative when present — the UI renders
      // it directly instead of re-deriving from text + step offsets.
      ...(parts.length > 0 ? { parts } : {}),
      // Park time (permission/question waits) so a reloaded turn keeps the
      // working-time elapsed instead of full wall-clock.
      ...(waitingMs > 0 ? { waitingMs } : {}),
      completedAt: Date.now(),
    }
    // Cost-attribution account (ADR 0054). Persist ONLY the id the turn ran on
    // (from the resolved run settings) — never a token/secret. Absent ⇒ the
    // Activity rollup falls back to the session's current accountId.
    if (params.settings.accountId !== undefined) message.accountId = params.settings.accountId
    if (opts.result) {
      message.modelUsed = opts.result.modelUsed
      message.usage = {
        inputTokens: opts.result.usage.input_tokens,
        outputTokens: opts.result.usage.output_tokens,
        cacheReadTokens: opts.result.usage.cache_read_tokens,
        cacheWriteTokens: opts.result.usage.cache_creation_tokens,
        ...(opts.result.contextChars ? { contextChars: opts.result.contextChars } : {}),
      }
      // Graceful `error` stop: the loop returned normally but the provider
      // failed mid-turn. Persist the cause so a reload shows the error alert
      // (+ retry) instead of an empty/finished-looking reply.
      if (opts.result.stopReason === 'error') {
        message.error = { message: opts.result.errorMessage ?? 'The model returned an error.' }
      }
    } else {
      // Reached on cancel/error: flag the truncated reply so the UI badges it.
      message.canceled = true
    }
    try {
      await appendEvent(params.sessionId, {
        type: 'message.appended',
        at: new Date().toISOString(),
        message,
      })
    } catch (err) {
      log.warn('failed to persist agent message', {
        sessionId: params.sessionId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Append a byte-minimal progress delta: ONLY the text + steps added since the
  // previous call, never the whole growing message. This is the root fix for the
  // O(steps²) JSONL bloat — pre-fix each throttled snapshot re-serialised the
  // full accumulated steps[], so a long turn could balloon a session file into
  // the gigabytes. The final `message.appended` snapshot (below) supersedes these
  // deltas by id; a hard kill mid-turn leaves them so the fold still rebuilds the
  // partial reply. Fire-and-forget: the per-session append lock serialises writes.
  const persistProgress = () => {
    const steps = [...collectedSteps.values()]
    const newSteps = steps.slice(persistedStepCount)
    const textDelta = accumulatedText.slice(persistedTextLen)
    if (!newSteps.length && !textDelta) return
    persistedTextLen = accumulatedText.length
    persistedStepCount = steps.length
    void appendEvent(params.sessionId, {
      type: 'message.progress',
      at: new Date().toISOString(),
      id: params.messageId,
      ...(textDelta ? { textDelta } : {}),
      ...(newSteps.length ? { steps: newSteps } : {}),
    }).catch((err) => {
      log.warn('failed to persist progress delta', {
        sessionId: params.sessionId,
        err: err instanceof Error ? err.message : String(err),
      })
    })
  }

  // Throttle mid-stream deltas so a hard kill loses at most ~1s of reply, without
  // writing a JSONL line per token.
  const PARTIAL_PERSIST_THROTTLE_MS = 1200
  let lastPartialPersistAt = 0
  const schedulePartialPersist = () => {
    const now = Date.now()
    if (now - lastPartialPersistAt < PARTIAL_PERSIST_THROTTLE_MS) return
    lastPartialPersistAt = now
    persistProgress()
  }

  let result
  try {
    result = await runStream(
      {
        sessionId: params.sessionId,
        pendingText: params.text,
        ...(attachments && attachments.length ? { pendingAttachments: attachments } : {}),
        // Prior turns: either what the UI sent (reference `ui`) or, when it sent
        // none (`ui-next`), the transcript folded from JSONL above. The runner
        // treats history as read-only SessionMessage[].
        history: historyForRun,
        settings: toSessionSettings(params.settings),
        ...(resolvedSystemPrompt ? { systemPrompt: resolvedSystemPrompt } : {}),
        ...(cwd ? { cwd } : {}),
        ...(params.projectId ? { projectId: params.projectId } : {}),
        ...(params.disabledTools && params.disabledTools.length
          ? { disabledTools: params.disabledTools }
          : {}),
        ...(mcpServersForRuntime ? { mcpServers: mcpServersForRuntime } : {}),
        ...(systemPromptAppend ? { systemPromptAppend } : {}),
        // Bulk-load section sizes for the context-window breakdown (the runtime
        // folds these into contextChars; it can't re-derive them from the joined
        // systemPromptAppend string).
        contextItems: {
          memoryFilesChars: bulkLoad.memoryFilesChars,
          customAgentsChars: bulkLoad.customAgentsChars,
          skillsChars: bulkLoad.skillsChars,
          memoryFilesList: bulkLoad.memoryFilesList,
          customAgentsList: bulkLoad.customAgentsList,
          skillsList: bulkLoad.skillsList,
        },
        ...(resolvedAllowedTools ? { allowedTools: resolvedAllowedTools } : {}),
        ...(params.compaction ? { compaction: params.compaction } : {}),
        canUseTool,
        askUserQuestion,
        abortController,
        // Mid-turn steering: hand the loop the steers queued via sessions.steer
        // for this assistant turn. The drain clears them so each lands once.
        getSteeringMessages: async () => drainSteer(params.messageId),
      },
      {
        onChunk: (delta) => {
          accumulatedText += delta
          appendTextPart(delta)
          emit('session.chunk', {
            sessionId: params.sessionId,
            messageId: params.messageId,
            delta,
          })
          schedulePartialPersist()
        },
        onStep: (step) => {
          // Stamp the reply position where this step fired (length of text
          // streamed so far) so a JSONL reload can re-interleave text ↔ steps in
          // chronological order. Preserve the first-seen offset across the
          // running→done upsert (and thinking re-emits) — the tool fired once.
          // Emit the stamped step so the live UI keeps the same value it persists.
          const prev = collectedSteps.get(step.id)
          const stamped: SessionStep = {
            ...prev,
            ...step,
            textOffset: prev?.textOffset ?? step.textOffset ?? accumulatedText.length,
          }
          collectedSteps.set(step.id, stamped)
          upsertStepPart(stamped)
          emit('session.step', {
            sessionId: params.sessionId,
            messageId: params.messageId,
            step: stamped,
          })
          schedulePartialPersist()
        },
      },
    )
    // Success → persist the authoritative final reply (full text + usage + steps).
    await persistAgent({ result })
  } catch (err) {
    // Cancel / error / runtime failure: runStreamPi throws here. Persist whatever
    // text + steps streamed so the partial reply survives reload, then re-throw
    // so the UI keeps its cancel/error handling.
    await persistAgent({})
    throw err
  } finally {
    abortController.signal.removeEventListener('abort', onAbort)
    // Defensive: if anything left a parked permission (e.g. a runtime error
    // without calling canUseTool back), reject so the Map doesn't leak.
    onAbort()
    unregisterAborter(params.messageId)
    // Close the steer channel — any steer that arrived after the loop's last
    // drain is discarded (the turn is over).
    endSteerTurn(params.messageId)
  }

  // Terminal event so UI can clear "loading" state purely from the stream,
  // independent of RPC promise resolution timing.
  emit('session.message.done', {
    sessionId: params.sessionId,
    messageId: params.messageId,
    text: result.text,
    modelUsed: result.modelUsed,
    usage: result.usage,
    stopReason: result.stopReason,
  })

  // Rewind snapshot (ADR 0038): capture the workspace state at the end of this
  // turn, keyed to the assistant message id. Fire-and-forget + gated on a
  // workspace; captureSnapshot never throws, so it can't disturb the reply, and
  // not awaiting keeps the UI finalize snappy.
  if (cwd) void captureSnapshot(params.sessionId, params.messageId, cwd)

  return {
    messageId: params.messageId,
    text: result.text,
    modelUsed: result.modelUsed,
    usage: result.usage,
    stopReason: result.stopReason,
    // Context-window breakdown (System prompt / Tools / Messages char sizes) so
    // the UI usage panel can itemise the window instead of showing token totals
    // only. Persisted on the message too (see persistAgent); forwarded live here.
    ...(result.contextChars ? { contextChars: result.contextChars } : {}),
    // Provider error cause on a graceful `error` stop — UI shows it in the turn's
    // error alert with a retry button.
    ...(result.errorMessage !== undefined ? { errorMessage: result.errorMessage } : {}),
    // Ordered timeline (ADR 0032). UI finalize stores this as the authoritative
    // message.parts; empty for a non-streaming reply with no steps (UI derives).
    ...(parts.length > 0 ? { parts } : {}),
  }
})
