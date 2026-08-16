import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import {
  runStream,
  registerAborter,
  unregisterAborter,
  type RunStreamResult,
} from '../sessions/runner.js'
import { appendMessage, loadSession, updateSessionMetadata } from '../sessions/store.js'
import { beginSteerTurn, endSteerTurn, drainSteer } from '../sessions/steering.js'
import { buildLinkedTaskBlock } from '../sessions/linked-task.js'
import { buildLinkedSshHostBlock } from '../sessions/linked-ssh-host.js'
import { buildSessionChecklistBlock } from '../sessions/todo-context.js'
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
import { listSources } from '../sources/store.js'
import { applyOAuthAuthorization } from '../sources/oauth-manager.js'
import {
  resolveSourceGate,
  accumulateSourceGate,
  gateToolFilterFields,
  emptyGateAccumulator,
  buildLocalSourcesNote,
} from '../sources/gate.js'
import { loadAgent, listAgents } from '../agents/store.js'
import { listSkills } from '../skills/store.js'
import { expandSecrets } from '../mcp/secrets.js'
import { applyBearerScheme } from '../mcp/auth-headers.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import { SKIP_DIRS } from '../fs/skip-dirs.js'
import { getEffectivePricing, cost as priceCost } from '../pricing/catalog.js'
import { readFile as fsReadFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type {
  AskUserQuestionFn,
  CanUseTool,
  McpServersConfig,
} from '../runtime/permission-types.js'
import type {
  ApiSource,
  ContextItemSize,
  LocalSource,
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
  // SSH tool approval mode (ADR 0064 P2). Gates the linked-host SSH tools. Default
  // 'prompt' (omitted) — ask before every gated SSH call.
  sshApprovalMode: z.enum(['prompt', 'session', 'auto']).optional(),
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
  // Absolute on-disk path of a binary/document attachment (no inline text). Bounded
  // so a hostile payload can't blow the prompt; the runtime injects it as a
  // reference line the model can Read via a tool when inside the workspace.
  path: z.string().max(4096).optional(),
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
  // Session defaults / behaviour prefs (Settings → Defaults / Sessions). Functional
  // — each is consumed by the runtime below:
  //   • instructions — extra guidance appended after the base system prompt (folded
  //     into systemPromptAppend so it augments, never replaces, the prompt). Bounded
  //     so an oversized IPC payload can't blow the prompt.
  instructions: z.string().max(20000).optional(),
  //   • autoApprove — when true, gated tool calls (Write/Edit/Bash/…) are auto-
  //     allowed without parking a permission prompt (the runtime skips the gate).
  autoApprove: z.boolean().optional(),
  //   • refeedImages — when false, prior-turn image attachments are NOT re-fed to
  //     the model each turn (only the turn that sent them carries them). Default true
  //     (omitted) keeps the current re-feed behaviour.
  refeedImages: z.boolean().optional(),
  //   • commitCoAuthor — Git setting. Controls the AWOG `Co-Authored-By` trailer on
  //     model-made commits: the Claude SDK path sets the SDK's native `attribution`
  //     (overriding the claude_code preset's Claude trailer); the Pi path appends
  //     CO_AUTHOR_INSTRUCTION. Omitted → on (default).
  commitCoAuthor: z.boolean().optional(),
  // Optional project linkage. When present, sidecar resolves the project's
  // on-disk path and passes it as the runtime tools' fs root so Read/Bash/Edit
  // operate against the user's repo instead of process.cwd().
  projectId: z.string().optional(),
  // Working folder dragged into the session (absolute on-disk path). Takes
  // precedence over the project-derived path as the runtime tools' cwd: the user
  // explicitly chose this folder. Validated (absolute + existing directory) below;
  // invalid → ignored, never errors the chat. A compact <workspace_tree> block is
  // injected so the model orients without a blind filesystem scan.
  workspacePath: z.string().optional(),
  // Folders attached to THIS turn as read-only context (absolute paths). Unlike
  // workspacePath these do NOT change the cwd — each is rendered as its own compact
  // <workspace_tree> block so the model can see the layout of every attached folder
  // (multi-folder). Bounded (count + validated absolute existing dir below) so a
  // hostile payload can't blow the prompt. Tools still operate in the resolved cwd.
  contextFolders: z.array(z.string().max(4096)).max(12).optional(),
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
  // Work link (ADR 0064, P1): the SSH host this session works with. When set, a
  // <linked_ssh_host> block (the host's connection info + metadata, NO secrets) is
  // injected into this turn's systemPromptAppend so the agent knows the machine.
  aboutSshHostId: z.string().optional(),
  // SSH terminal co-pilot (ADR 0064): the connId of the interactive shell the user
  // is watching (docked session in /ssh). When set, the agent gets ssh_terminal_run
  // (drives THIS visible terminal) instead of the headless ssh_exec. Ephemeral —
  // the UI sends the currently-targeted terminal each turn (not persisted).
  sshTerminalConnId: z.string().optional(),
  // Session-pinned working-set: files (workspace-relative paths, read fresh each
  // turn) + free-text notes, injected as a <pinned_context> block. Mirrors the
  // session's persisted pinnedContext; forwarded each turn (same trust model as
  // disabledTools/mcpServerIds). Files are path-sanitized against cwd below.
  pinnedContext: z
    .object({
      files: z.array(z.string()).max(20).optional(),
      notes: z.string().max(20000).optional(),
      notePresets: z.array(z.string().max(20000)).max(20).optional(),
    })
    .optional(),
  // Hard budget caps (Pha 3). `hardLimitUsd` refuses a turn once the session's
  // cumulative cost reaches it (cost computed sidecar-side from persisted turns —
  // the limit is the user's config intent, forwarded here). `maxToolCalls` /
  // `maxWallclockMs` cap a single turn (enforced in the runtime beforeToolCall).
  budget: z
    .object({
      hardLimitUsd: z.number().nonnegative().optional(),
      maxToolCalls: z.number().int().nonnegative().optional(),
      maxWallclockMs: z.number().int().nonnegative().optional(),
    })
    .optional(),
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
  if (parsed.sshApprovalMode !== undefined) base.sshApprovalMode = parsed.sshApprovalMode
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
  if (a.path !== undefined) base.path = a.path
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

// Per-turn cost in USD from the resolved model + token buckets (single source of
// truth = pricing/catalog). Returns undefined when the model has no known price so
// the UI shows "n/a" instead of a wrong $0. Default catalog only (no overrides/remote
// here — the Activity rollup remains the authoritative cost report).
function computeTurnCostUsd(modelUsed: string, usage: RunStreamResult['usage']): number | undefined {
  const price = getEffectivePricing(modelUsed, {})
  if (!price) return undefined
  return priceCost(
    {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_tokens,
      cacheWriteTokens: usage.cache_creation_tokens,
    },
    price,
  )
}

// ── Pinned context (session working-set) ────────────────────────────────────
// Per-file + total caps so a pinned working-set can't blow the prompt / cost.
const MAX_PINNED_FILE_CHARS = 24_000
const MAX_PINNED_TOTAL_CHARS = 80_000

// Build the <pinned_context> block from the session's pinned files + notes. Files
// are read fresh each turn (path-sanitized against cwd via assertInsideWorkspace —
// security invariant #2); missing/oversized files are skipped/truncated with a note
// so the model never silently sees stale or partial content as complete. Returns
// undefined when nothing pins. Best-effort: never throws.
async function buildPinnedContextBlock(
  pinned:
    | { files?: string[] | undefined; notes?: string | undefined; notePresets?: string[] | undefined }
    | undefined,
  cwd: string | undefined,
): Promise<string | undefined> {
  if (!pinned) return undefined
  const parts: string[] = []
  let total = 0

  if (cwd && pinned.files?.length) {
    for (const rel of pinned.files) {
      if (total >= MAX_PINNED_TOTAL_CHARS) break
      let abs: string
      try {
        abs = assertInsideWorkspace(cwd, rel)
      } catch {
        continue // outside workspace → skip (never read arbitrary paths)
      }
      let content: string
      try {
        // eslint-disable-next-line no-await-in-loop
        content = await fsReadFile(abs, 'utf8')
      } catch {
        continue // missing / unreadable / binary → skip
      }
      const budget = Math.min(MAX_PINNED_FILE_CHARS, MAX_PINNED_TOTAL_CHARS - total)
      const truncated = content.length > budget
      const body = truncated ? `${content.slice(0, budget)}\n…[truncated]` : content
      total += body.length
      parts.push(`<file path="${rel}">\n${body}\n</file>`)
    }
  }

  const notes = pinned.notes?.trim()
  if (notes) parts.push(`<notes>\n${notes}\n</notes>`)

  // Applied reusable notes — each as its own <notes> entry (same trust/injection as the
  // free-text notes above; not read from disk, so no path sanitize needed).
  for (const preset of pinned.notePresets ?? []) {
    const t = preset.trim()
    if (t) parts.push(`<notes>\n${t}\n</notes>`)
  }

  if (!parts.length) return undefined
  return `<pinned_context>
The user pinned the following context to this session. Treat it as always-relevant background for every turn.
${parts.join('\n')}
</pinned_context>`
}

// ── Workspace tree (dragged folder) ─────────────────────────────────────────
// When the user drags a folder into the session it becomes the turn's cwd. We
// inject a compact, bounded tree so the model knows what's there without a blind
// `find` (the original bug this feature fixes). Bounded by depth + entry count so
// a huge folder can't blow the prompt; SKIP_DIRS (node_modules/.git/…) are
// pruned, symlinks never followed (security invariant #2 via assertInsideWorkspace).
const MAX_TREE_ENTRIES = 300
const MAX_TREE_DEPTH = 4

// Default intro for the cwd's own tree (dragged working folder).
const CWD_TREE_INTRO =
  'The user dragged this folder into the session; it is your working directory (cwd) for this turn. Read/Write/Edit/Bash operate inside it — use these paths directly instead of searching the filesystem.'

async function buildWorkspaceTreeBlock(
  root: string | undefined,
  intro: string = CWD_TREE_INTRO,
): Promise<string | undefined> {
  if (!root) return undefined
  const lines: string[] = []
  let count = 0
  let truncated = false

  async function walk(relDir: string, depth: number): Promise<void> {
    if (truncated || depth > MAX_TREE_DEPTH) return
    let absDir: string
    try {
      absDir = assertInsideWorkspace(root!, relDir || '.')
    } catch {
      return // escapes root (symlink) → skip
    }
    let dirents
    try {
      // eslint-disable-next-line no-await-in-loop
      dirents = await readdir(absDir, { withFileTypes: true })
    } catch {
      return // unreadable → skip
    }
    dirents.sort((a, b) => {
      const ad = a.isDirectory() ? 0 : 1
      const bd = b.isDirectory() ? 0 : 1
      return ad !== bd ? ad - bd : a.name.localeCompare(b.name)
    })
    const indent = '  '.repeat(depth)
    for (const dirent of dirents) {
      if (count >= MAX_TREE_ENTRIES) {
        truncated = true
        return
      }
      const { name } = dirent
      if (dirent.isSymbolicLink()) continue // never follow symlinks
      if (dirent.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue
        lines.push(`${indent}${name}/`)
        count += 1
        // eslint-disable-next-line no-await-in-loop
        await walk(relDir ? `${relDir}/${name}` : name, depth + 1)
      } else if (dirent.isFile()) {
        lines.push(`${indent}${name}`)
        count += 1
      }
    }
  }

  await walk('', 0)
  if (!lines.length) return undefined
  const body = truncated ? `${lines.join('\n')}\n…[truncated]` : lines.join('\n')
  return `<workspace_tree root="${root}">
${intro}
${body}
</workspace_tree>`
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
  // Active compaction checkpoint (ADR 0047). The reference `ui` forwards it in the
  // payload; `ui-next` does NOT track it client-side, so — like history — we fold
  // it from the persisted session (the JSONL `session.compacted` event is the
  // source of truth). This is what makes BOTH manual /compact AND auto-compact
  // actually cut the model context on the next turn: the checkpoint persisted by
  // sessions.compact is read back here and passed to runStream. An explicit
  // `params.compaction` (reference `ui`) still wins.
  let compactionForRun = params.compaction
  // Claude Agent SDK resume handle (ADR 0058, Anthropic path). The SDK owns
  // conversation history + compaction in its own session store; runStreamClaude
  // passes this as `resume`. Read alongside the history fold when we already load
  // the session; otherwise (history came inline from the UI) do a targeted read
  // for the Anthropic provider only. Undefined ⇒ a fresh SDK session is started.
  let sdkSessionId: string | undefined
  if (historyForRun.length === 0) {
    try {
      const loaded = await loadSession(params.sessionId)
      if (loaded && loaded.messages.length > 0) historyForRun = loaded.messages
      if (!compactionForRun && loaded?.compaction) compactionForRun = loaded.compaction
      sdkSessionId = loaded?.sdkSessionId
    } catch (err) {
      log.warn('failed to fold session history for resume', {
        sessionId: params.sessionId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  } else if (toSessionSettings(params.settings).provider === 'anthropic') {
    try {
      const loaded = await loadSession(params.sessionId)
      sdkSessionId = loaded?.sdkSessionId
    } catch {
      /* no persisted SDK session yet → start fresh */
    }
  }

  // Hard budget guard (Pha 3): refuse the turn BEFORE any model call when the
  // session's cumulative cost already reached the hard cap. Cost is summed from the
  // persisted turns (historyForRun) — never trusted from the client — while the
  // limit is the user's config intent forwarded in params. Returns early (before
  // registering the aborter / persisting) so a refused turn leaves no side effects;
  // the UI surfaces `budget-exceeded` and prompts to raise the cap.
  const hardLimitUsd = params.budget?.hardLimitUsd
  if (hardLimitUsd && hardLimitUsd > 0) {
    const spentUsd = historyForRun.reduce(
      (sum, m) => sum + (m.role === 'agent' ? (m.usage?.costUsd ?? 0) : 0),
      0,
    )
    if (spentUsd >= hardLimitUsd) {
      const errorMessage = `Session budget exceeded: $${spentUsd.toFixed(2)} ≥ $${hardLimitUsd.toFixed(2)} hard cap. Raise the cap in session config to continue.`
      emit('session.message.done', {
        sessionId: params.sessionId,
        messageId: params.messageId,
        text: '',
        stopReason: 'budget-exceeded',
        // Carry the cause on this terminal event so the UI surfaces the alert
        // from the stream — the sendMessage RPC response can be dropped/land late.
        errorMessage,
      })
      return {
        messageId: params.messageId,
        text: '',
        modelUsed: params.settings.modelId,
        usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 },
        stopReason: 'budget-exceeded',
        errorMessage,
      }
    }
  }

  // One AbortController per turn. sessions.cancel resolves it by messageId.
  const abortController = new AbortController()
  // This turn signal fans out to undici (per LLM request), parallel tool calls,
  // and subagents — lift Node's 10-listener cap to silence the false-positive
  // MaxListenersExceededWarning (see runtime/turn-signal.ts).
  liftTurnSignalListenerCap(abortController.signal)
  registerAborter(params.sessionId, params.messageId, abortController)
  // Open the steer channel ONLY for runtimes that actually consume it. The Pi
  // runtime polls getSteeringMessages at each turn boundary; the Claude SDK
  // runtime (anthropic) runs a single-prompt query with NO steering hook, so
  // opening the channel there would make sessions.steer report success while the
  // steer is silently discarded at turn end (the UI loses the message). Gating it
  // → sessions.steer returns { ok: false } on that path so the UI falls back to
  // queueing the text as a follow-up turn instead of dropping it.
  const supportsSteering = toSessionSettings(params.settings).provider !== 'anthropic'
  if (supportsSteering) beginSteerTurn(params.messageId)

  // Resolve cwd from project, if linked. Best-effort: missing project → no
  // cwd (the runtime falls back to process.cwd()). Don't error the chat for a
  // stale projectId.
  let cwd: string | undefined
  // Dragged working folder wins: the user explicitly chose it this session.
  // Validate absolute + existing directory; invalid → ignore (fall through),
  // never error the chat.
  if (params.workspacePath) {
    try {
      if (isAbsolute(params.workspacePath) && (await stat(params.workspacePath)).isDirectory()) {
        cwd = params.workspacePath
      } else {
        log.warn('ignoring non-absolute / non-directory workspacePath', {
          workspacePath: params.workspacePath,
        })
      }
    } catch (err) {
      log.warn('failed to stat workspacePath', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  if (!cwd && params.projectId) {
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
  // bridges these to in-process Pi tools. Source of truth is the `sources` store
  // (ADR 0060) — we only forward enabled `mcp`-kind sources with a usable
  // stdio/http block; disabled entries shouldn't surface tools to the model.
  // Per-session whitelist (params.mcpServerIds) further narrows the set:
  //   undefined → all enabled (legacy)
  //   []        → none
  //   [ids]     → only those (∩ enabled)
  // The whitelist keys are source ids (= the old MCP id after migration).
  let mcpServersForRuntime: McpServersConfig | undefined
  // Enabled `api`-kind sources (ADR 0060 P3), passed to the runtime alongside the
  // mcp map. Same whitelist rules as mcp; the runtime bridges each to one
  // `mcp__<id>__api_<slug>` tool (Pi path). The credential lives in the keychain
  // (never here) and is read fresh per call.
  const apiSourcesForRuntime: ApiSource[] = []
  // Track which servers actually made it through so we can build a matching
  // system-prompt nudge (only when user explicitly whitelisted).
  const attachedMcpServers: { id: string; name: string }[] = []
  // Per-source Explore scoping (ADR 0060 P4): filled per surviving source; empty
  // when no source declared trust:'prompt' / permissions.json (no behaviour change).
  const gateAcc = emptyGateAccumulator()
  // Enabled `local` (filesystem) sources — surfaced to the agent via a system-prompt
  // note (no runtime tools). ADR 0060 P4.
  const localSources: LocalSource[] = []
  try {
    const all = await listSources()
    // Two whitelist layers (ADR 0016): session-level (params.mcpServerIds) and
    // agent-level (resolvedAgentMcpIds). Intersect both when present so the
    // narrower scope wins. undefined = "no restriction at this layer".
    const sessionWhitelist =
      params.mcpServerIds !== undefined ? new Set(params.mcpServerIds) : null
    const agentWhitelist = resolvedAgentMcpIds ? new Set(resolvedAgentMcpIds) : null
    const entries: [string, McpServersConfig[string]][] = []
    for (const s of all) {
      if (!s.enabled) continue
      // Same session ∩ agent whitelist as mcp — the keys are source ids.
      if (sessionWhitelist && !sessionWhitelist.has(s.id)) continue
      if (agentWhitelist && !agentWhitelist.has(s.id)) continue
      // Per-source P4 gate (ADR 0060): trust:'deny' drops the source entirely (its
      // tools never exist); trust:'prompt' + permissions.json feed the accumulator
      // consumed by the tool filter + gate below.
      // eslint-disable-next-line no-await-in-loop
      const gate = await resolveSourceGate(s)
      if (gate.trust === 'deny') continue
      accumulateSourceGate(gateAcc, s.id, gate)
      // local source → surfaced to the agent via a system-prompt note (no tools).
      if (s.type === 'local') {
        localSources.push(s)
        continue
      }
      // api source → forwarded whole to the runtime (no secret in config). NOT
      // added to the mcp nudge (that lists `mcp__<id>__*` for CLI-preference; the
      // api tool's own description suffices, and the nudge is provider-agnostic).
      if (s.type === 'api') {
        apiSourcesForRuntime.push(s)
        continue
      }
      if (s.type !== 'mcp') continue
      const transport = s.mcp.transport ?? 'http'
      let cfg: McpServersConfig[string]
      if (transport === 'stdio') {
        if (!s.mcp.command) continue
        // Expand `secret:KEY` placeholders in env against OS keychain — ADR 0018.
        // The runtime passes plaintext env to the in-process MCP child. The
        // expansion happens fresh per turn so a re-saved keychain value
        // takes effect on the next message.
        // eslint-disable-next-line no-await-in-loop
        const expandedEnv = await expandSecrets(s.id, s.mcp.env)
        cfg = {
          type: 'stdio',
          command: s.mcp.command,
          ...(s.mcp.args ? { args: s.mcp.args } : {}),
          ...(Object.keys(expandedEnv).length > 0 ? { env: expandedEnv } : {}),
          // Per-server handshake budget — `npx -y` cold starts can exceed the
          // bridge default; honour the user's configured timeout.
          timeoutMs: s.timeoutMs,
        }
      } else if (transport === 'http') {
        if (!s.mcp.url) continue
        // eslint-disable-next-line no-await-in-loop
        const expandedHeaders = applyBearerScheme(
          s.mcp.authType,
          await expandSecrets(s.id, s.mcp.headers),
        )
        // Layer a fresh `Authorization: Bearer <token>` (refreshed if near
        // expiry) on top of the static headers for oauth sources — ADR 0060 D-4.
        // No-op for bearer/none. Runs per turn, so a refreshed token takes effect
        // on the next message.
        // eslint-disable-next-line no-await-in-loop
        const headers = await applyOAuthAuthorization(s, expandedHeaders)
        cfg = {
          type: 'http',
          url: s.mcp.url,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
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
    log.warn('failed to list sources for session', {
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

  // Local sources (ADR 0060 P4): surface attached filesystem folders so the agent
  // knows where it may explore. Informational — hard fs-root enforcement is
  // deferred (see buildLocalSourcesNote).
  const localSourcesNote = buildLocalSourcesNote(localSources)
  if (localSourcesNote) {
    systemPromptAppend = systemPromptAppend
      ? `${systemPromptAppend}\n\n${localSourcesNote}`
      : localSourcesNote
  }

  // User instructions (Settings → Defaults → instructions). Extra always-on
  // guidance appended after the base system prompt (augments, never replaces it).
  // Wrapped in a labelled block so the model reads it as the user's standing
  // directives, folded into systemPromptAppend before the bulk-load catalogue.
  const instructions = params.instructions?.trim()
  if (instructions) {
    const block = `<user_instructions>\n${instructions}\n</user_instructions>`
    systemPromptAppend = systemPromptAppend ? `${systemPromptAppend}\n\n${block}` : block
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

  // Editable checklist: inject the session's CURRENT checklist as a
  // <session_checklist> block so a user edit made in the UI reaches the model
  // instead of being overwritten by its next TodoWrite. Read from disk (not from
  // the client payload) so the persisted list stays the single source of truth.
  // Passed to the runner as its OWN field, not folded into systemPromptAppend:
  // the Claude SDK freezes the preset append at session creation, so there the
  // block has to ride on the turn prompt to survive `resume` (see runner.ts).
  // Best-effort — no checklist, or an unreadable session, yields no block.
  let sessionChecklist: string | undefined
  try {
    const withTodos = await loadSession(params.sessionId)
    sessionChecklist = buildSessionChecklistBlock(withTodos?.todos)
  } catch {
    /* best-effort: never block the turn on the checklist block */
  }

  // Work link (ADR 0064, P1): when this session works with an SSH host, inject the
  // host's connection info as a <linked_ssh_host> block (NO secrets). Rebuilt each
  // turn so an edited host stays fresh. Best-effort — a missing host yields no block.
  if (params.aboutSshHostId) {
    const linkedSshHost = await buildLinkedSshHostBlock(params.aboutSshHostId)
    if (linkedSshHost) {
      systemPromptAppend = systemPromptAppend
        ? `${systemPromptAppend}\n\n${linkedSshHost}`
        : linkedSshHost
    }
  }

  // Pinned context (session working-set): prepend so it leads the appended context
  // and rules (added later in run-stream) can still override it. Read fresh each
  // turn so edits to a pinned file take effect on the next message.
  const pinnedBlock = await buildPinnedContextBlock(params.pinnedContext, cwd)
  if (pinnedBlock) {
    systemPromptAppend = systemPromptAppend
      ? `${pinnedBlock}\n\n${systemPromptAppend}`
      : pinnedBlock
  }

  // Dragged working folder → compact tree so the model uses real paths instead of
  // a blind scan. Only when the cwd actually came from an explicit workspacePath
  // (not a project repo, whose layout the model can discover on demand).
  if (params.workspacePath && cwd === params.workspacePath) {
    const treeBlock = await buildWorkspaceTreeBlock(cwd)
    if (treeBlock) {
      systemPromptAppend = systemPromptAppend
        ? `${treeBlock}\n\n${systemPromptAppend}`
        : treeBlock
    }
  }

  // Attached context folders (multi-folder) → one <workspace_tree> block each so the
  // model sees every attached folder's layout. Unlike workspacePath these do NOT
  // change the cwd — they're read-only orientation. Validated per folder (absolute +
  // existing dir); invalid entries skipped, never error the chat. Deduped, and the
  // cwd's own tree (built above) isn't repeated. Tools still operate in `cwd`, so a
  // folder outside it is browsable in the tree but only Read-able if inside cwd.
  if (params.contextFolders?.length) {
    const contextIntro =
      'The user attached this folder to the session as read-only context — its structure is shown below for orientation. It is NOT your working directory; a file here is only Read-able with a tool when it sits inside your working directory (cwd).'
    const seen = new Set<string>(cwd ? [cwd] : [])
    const folderBlocks: string[] = []
    for (const folder of params.contextFolders) {
      if (seen.has(folder)) continue
      seen.add(folder)
      let isDir = false
      try {
        // eslint-disable-next-line no-await-in-loop
        isDir = isAbsolute(folder) && (await stat(folder)).isDirectory()
      } catch {
        isDir = false
      }
      if (!isDir) {
        log.warn('ignoring non-absolute / non-directory contextFolder', { folder })
        continue
      }
      // eslint-disable-next-line no-await-in-loop
      const treeBlock = await buildWorkspaceTreeBlock(folder, contextIntro)
      if (treeBlock) folderBlocks.push(treeBlock)
    }
    if (folderBlocks.length) {
      const joined = folderBlocks.join('\n\n')
      systemPromptAppend = systemPromptAppend ? `${joined}\n\n${systemPromptAppend}` : joined
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
  // Cheap change-detection for the throttled partial persist (see persistProgress):
  // skip the in-memory upsert + enqueue when nothing grew since the last call.
  let lastPersistedTextLen = 0
  let lastPersistedStepCount = 0

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
  // steps + parts + usage). appendMessage upserts by message id over any mid-stream
  // partial written by persistProgress — last write wins. Called once per turn at
  // every exit (success, cancel, error). appendMessage no-ops if the session was
  // deleted mid-turn (it is no longer in the manager's map).
  const persistAgent = async (opts: { result?: RunStreamResult; error?: string }) => {
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
      const costUsd = computeTurnCostUsd(opts.result.modelUsed, opts.result.usage)
      message.usage = {
        inputTokens: opts.result.usage.input_tokens,
        outputTokens: opts.result.usage.output_tokens,
        cacheReadTokens: opts.result.usage.cache_read_tokens,
        cacheWriteTokens: opts.result.usage.cache_creation_tokens,
        ...(costUsd !== undefined ? { costUsd } : {}),
        ...(opts.result.contextChars ? { contextChars: opts.result.contextChars } : {}),
      }
      // Graceful `error` stop: the loop returned normally but the provider
      // failed mid-turn. Persist the cause so a reload shows the error alert
      // (+ retry) instead of an empty/finished-looking reply.
      if (opts.result.stopReason === 'error') {
        message.error = { message: opts.result.errorMessage ?? 'The model returned an error.' }
      }
    } else if (opts.error !== undefined) {
      // Thrown runtime error (auth expired, chat failed, runtime crash — NOT a user
      // cancel): persist the cause as `error` so a reload shows the alert + retry,
      // identical to a graceful `error` stop. Persisting it as `canceled` would make
      // ui-next render a silent empty bubble (it has no canceled badge).
      message.error = { message: opts.error }
    } else {
      // Reached on cancel: flag the truncated reply so the UI badges it.
      message.canceled = true
    }
    try {
      await appendMessage(params.sessionId, message)
    } catch (err) {
      log.warn('failed to persist agent message', {
        sessionId: params.sessionId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Persist the CURRENT partial assistant message (id, full accumulated text +
  // steps + parts). appendMessage upserts it in the manager's warm cache and
  // enqueues a DEBOUNCED (500ms-coalesced) atomic write — the single-file format
  // rewrites the whole transcript per save, so there is no per-tick JSONL bloat
  // (the root cause the old byte-minimal `message.progress` delta worked around).
  // That debounce IS the crash-safety/periodic flush: a hard kill mid-turn leaves
  // the last coalesced partial on disk, which a reload surfaces as the partial
  // reply. The authoritative final snapshot (persistAgent) upserts over this by id.
  // Fire-and-forget; cheap early-return when nothing grew since the last call.
  const persistProgress = () => {
    const steps = [...collectedSteps.values()]
    if (accumulatedText.length === lastPersistedTextLen && steps.length === lastPersistedStepCount) {
      return
    }
    lastPersistedTextLen = accumulatedText.length
    lastPersistedStepCount = steps.length
    const partial: SessionMessage = {
      id: params.messageId,
      role: 'agent',
      text: accumulatedText,
      at: new Date().toISOString(),
      ...(steps.length > 0 ? { steps } : {}),
      ...(parts.length > 0 ? { parts } : {}),
    }
    void appendMessage(params.sessionId, partial).catch((err) => {
      log.warn('failed to persist partial agent message', {
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
        // Linked SSH host (ADR 0064 P2): the Pi runtime pushes the scoped SSH tools
        // for this host. sshApprovalMode rides along in `settings`.
        ...(params.aboutSshHostId ? { aboutSshHostId: params.aboutSshHostId } : {}),
        ...(params.sshTerminalConnId ? { sshTerminalConnId: params.sshTerminalConnId } : {}),
        ...(params.disabledTools && params.disabledTools.length
          ? { disabledTools: params.disabledTools }
          : {}),
        ...(mcpServersForRuntime ? { mcpServers: mcpServersForRuntime } : {}),
        // Enabled api sources (ADR 0060 P3) → mcp__<id>__api_<slug> tools (Pi).
        ...(apiSourcesForRuntime.length ? { apiSources: apiSourcesForRuntime } : {}),
        // Per-source Explore scoping (ADR 0060 P4): trust:'prompt' routes tools
        // through the ask-gate; allowedMcpPatterns / allowedApiEndpoints restrict a
        // source to its own tools/endpoints. All no-op when nothing was declared.
        ...(gateAcc.promptSourceIds.length ? { promptSourceIds: gateAcc.promptSourceIds } : {}),
        ...gateToolFilterFields(gateAcc),
        ...(systemPromptAppend ? { systemPromptAppend } : {}),
        ...(sessionChecklist ? { sessionChecklist } : {}),
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
        // Compaction checkpoint: explicit payload (reference `ui`) or folded from the
        // persisted session (`ui-next` / auto-compact) — see compactionForRun above.
        ...(compactionForRun ? { compaction: compactionForRun } : {}),
        // Auto-approve (Settings → Sessions): skip the permission park for gated
        // tools when the user opted in. The runtime's beforeToolCall bypasses
        // canUseTool entirely (see makeBeforeToolCall).
        ...(params.autoApprove ? { autoApprove: true } : {}),
        // Re-feed images (Settings → Sessions): when false the context builder drops
        // prior-turn image attachments (only the current turn carries them).
        ...(params.refeedImages === false ? { refeedImages: false } : {}),
        // Co-author trailer (Settings → Git). Forward only the explicit opt-OUT so
        // the runtime keeps its default-on behaviour when the field is omitted.
        ...(params.commitCoAuthor === false ? { commitCoAuthor: false } : {}),
        // Per-turn hard caps (tool-call count / wallclock) enforced in the runtime
        // beforeToolCall. Forward only the defined fields.
        ...(params.budget?.maxToolCalls !== undefined || params.budget?.maxWallclockMs !== undefined
          ? {
              budget: {
                ...(params.budget.maxToolCalls !== undefined
                  ? { maxToolCalls: params.budget.maxToolCalls }
                  : {}),
                ...(params.budget.maxWallclockMs !== undefined
                  ? { maxWallclockMs: params.budget.maxWallclockMs }
                  : {}),
              },
            }
          : {}),
        canUseTool,
        askUserQuestion,
        abortController,
        // Claude SDK resume handle (ADR 0058, Anthropic path). Ignored by Pi.
        ...(sdkSessionId ? { sdkSessionId } : {}),
        // Mid-turn steering: hand the loop the steers queued via sessions.steer
        // for this assistant turn (Pi only — the Claude SDK path has no steering
        // hook, see supportsSteering above). The drain clears them so each lands once.
        ...(supportsSteering
          ? { getSteeringMessages: async () => drainSteer(params.messageId) }
          : {}),
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
    // Persist the (possibly rotated) Claude SDK session id so the next turn
    // resumes this SDK session (ADR 0058, Anthropic path). Only when it changed.
    if (result.sdkSessionId && result.sdkSessionId !== sdkSessionId) {
      await updateSessionMetadata(params.sessionId, {
        sdkSessionId: result.sdkSessionId,
      }).catch((err) => {
        log.warn('failed to persist sdk session id', {
          sessionId: params.sessionId,
          err: err instanceof Error ? err.message : String(err),
        })
      })
    }
  } catch (err) {
    // Cancel / error / runtime failure: runStreamPi throws here (always an RpcError
    // via mapErrorToRpc). Persist whatever text + steps streamed so the partial reply
    // survives reload, flagged by outcome: a user cancel → `canceled`; any other
    // thrown error → `error` (with the specific cause) so reload shows the alert + retry.
    const isCancel = err instanceof RpcError && err.code === -32023
    const errMsg = err instanceof Error ? err.message : String(err)
    await persistAgent(isCancel ? {} : { error: errMsg })
    // Terminal event on the RELIABLE stream so the UI finalizes — and surfaces the
    // error alert — even if the RPC reject below is dropped or lands late. Cancel →
    // 'aborted' (no alert); any other thrown error → 'error' with the cause + retry.
    emit('session.message.done', {
      sessionId: params.sessionId,
      messageId: params.messageId,
      stopReason: isCancel ? 'aborted' : 'error',
      ...(isCancel ? {} : { errorMessage: errMsg }),
    })
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
    // Provider error cause on a graceful `error` stop. Carried here — not only in
    // the RPC result below — because this terminal event is the RELIABLE finalize
    // signal: the sendMessage RPC response can land late or be dropped (see the
    // session.message.done handler in the UI store), and the error alert must not
    // depend on it landing.
    ...(result.errorMessage !== undefined ? { errorMessage: result.errorMessage } : {}),
  })

  // Rewind snapshot (ADR 0038): capture the workspace state at the end of this
  // turn, keyed to the assistant message id. Fire-and-forget + gated on a
  // workspace; captureSnapshot never throws, so it can't disturb the reply, and
  // not awaiting keeps the UI finalize snappy.
  if (cwd) void captureSnapshot(params.sessionId, params.messageId, cwd)

  // Breadcrumb bracketing the post-turn finalize path (persist → done emit →
  // snapshot). Paired with run-stream's "chat stream done": if that logged but this
  // did NOT, the engine froze INSIDE this handler; if both logged yet the engine went
  // silent, the freeze is on a later timer callback (debounce persist / usage poll),
  // not here. Diagnoses the post-turn freeze the engine heartbeat recovers from.
  log.info('chat turn finalized', {
    sessionId: params.sessionId,
    messageId: params.messageId,
    stopReason: result.stopReason,
  })

  const turnCostUsd = computeTurnCostUsd(result.modelUsed, result.usage)
  return {
    messageId: params.messageId,
    text: result.text,
    modelUsed: result.modelUsed,
    // Forward per-turn cost (USD) alongside the token buckets so the UI can sum the
    // session's cumulative cost. Omitted when the model has no known price.
    usage: turnCostUsd !== undefined ? { ...result.usage, cost_usd: turnCostUsd } : result.usage,
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
