// Shared types across sidecar modules. Names mirror RPC payload shape.

export type ProviderName = 'anthropic' | 'openai' | 'google'

export type AuthMode = 'oauth' | 'apikey'

// Wire protocol a custom endpoint speaks (ADR 0029 Phase C3). Maps to a Pi
// `Model.api`: 'anthropic-messages' = the Anthropic Messages API (Phase B
// default), 'openai-completions' = the OpenAI Chat Completions API (Ollama,
// vLLM, LM Studio, OpenRouter, …). Undefined ⇒ inferred from the provider:
// anthropic → anthropic-messages, openai/google → their native api.
export type EndpointApi = 'anthropic-messages' | 'openai-completions'

export type AccountStatus = 'connected' | 'expired' | 'disconnected'

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope?: string
  tokenUuid?: string
}

// Raw OAuth credential blob owned + refreshed by the Pi SDK (pi
// `OAuthCredentials`: { refresh, access, expires, ...providerExtras }). Stored
// VERBATIM because pi carries provider-specific extra fields (e.g. the codex
// chatgpt_account_id) it needs at request time — AWOG must not reshape it.
// Used for pi-managed OAuth providers (openai-codex now; copilot/vertex later)
// whose token shape does NOT match AWOG's anthropic-shaped OAuthTokens. SECRET
// — never leaves the sidecar (stripped in toSafe). See ADR 0029.
export type PiOAuthCredentials = Record<string, unknown>

export interface AccountOrg {
  uuid: string
  name: string
}

export interface AccountIdentity {
  uuid: string
  email: string
}

export interface AccountRecord {
  id: string
  label: string
  authMode: AuthMode
  oauth?: OAuthTokens
  // Raw pi OAuth credentials for a pi-managed OAuth provider (ADR 0029 — OpenAI
  // Codex / ChatGPT subscription). When set, authMode is 'oauth' and the runtime
  // resolves the bearer token via pi's getOAuthApiKey instead of AWOG's anthropic
  // token-manager. SECRET — stripped by toSafe. `oauth` (anthropic-shaped) and
  // `piOAuth` are mutually exclusive per account.
  piOAuth?: PiOAuthCredentials
  apiKey?: string
  // Custom endpoint base URL (ADR 0026 Phase B / ADR 0029 Phase C3). When set,
  // the runtime points the Pi Model at this base URL instead of the provider
  // default. Only meaningful for apikey accounts. Non-secret.
  baseURL?: string
  // Wire protocol the custom endpoint speaks (ADR 0029 Phase C3). Undefined ⇒
  // inferred from provider (anthropic → anthropic-messages, else openai-
  // completions). Only meaningful when baseURL is set.
  api?: EndpointApi
  // Model ids exposed by a custom endpoint (user-supplied). Drives the agent
  // model picker; bypasses the built-in model allowlist at runtime.
  models?: string[]
  organization?: AccountOrg
  account?: AccountIdentity
  version: number
  createdAt: string
}

export interface AccountSafe {
  id: string
  label: string
  authMode: AuthMode
  fingerprint: string
  status: AccountStatus
  expiresAt?: number
  // Surfaced for custom endpoints (non-secret) so the UI can show / pick them.
  baseURL?: string
  api?: EndpointApi
  models?: string[]
  organization?: AccountOrg
  account?: AccountIdentity
  version: number
  createdAt: string
}

export interface ProviderBucket {
  accounts: AccountRecord[]
  activeAccountId: string | null
}

export interface CredentialsFile {
  version: 1
  providers: Record<ProviderName, ProviderBucket>
}

export interface OAuthState {
  verifier: string
  createdAt: number
}

// ─── Workspace filesystem (read-only) ────────────────────────────────────────
// Used by the Session workspace panel's Files tab. `path` is workspace-relative
// (POSIX-style); all I/O is gated by assertInsideWorkspace.

export interface FsEntry {
  name: string
  path: string
  kind: 'file' | 'dir'
  size?: number
}

export interface FsFileContent {
  path: string
  content: string
  language?: string
  truncated: boolean
  isBinary: boolean
}

// Raw file bytes as base64 for in-app preview of rich/binary formats (PDF,
// images) that FsFileContent can't carry. `base64` is '' when the file exceeds
// the cap (truncated=true) — the caller should fall back to opening externally.
export interface FsFileBase64 {
  path: string
  base64: string
  mimeType: string
  size: number
  truncated: boolean
}

export interface FsSearchMatch {
  // Workspace-relative file path.
  path: string
  // 1-based line number.
  line: number
  // 1-based column of the first match on the line (best-effort).
  column: number
  // The matched line content (trimmed/capped for the IPC payload).
  preview: string
}

// ─── Session (chat) ────────────────────────────────────────────────────────
// Mirror of UI shape (apps/desktop/ui-next/types/index.ts). Sidecar M4 keeps these
// in-memory only via per-request snapshots from the UI.
// TODO M6: persist sessions to JSONL; M4 keeps in-memory only.

export type ThinkingLevel = 'low' | 'medium' | 'high' | 'extra-high' | 'max'

export type AgentMode = 'ask' | 'accept-edits' | 'plan' | 'execute'

// Per-session SSH tool approval mode (ADR 0064 P2). Governs the gated SSH tools
// (ssh_exec / ssh_write_file) INDEPENDENTLY of the session AgentMode — running a
// command or writing a file on a REMOTE host is higher-consequence than a local
// workspace edit, so it has its own mandatory gate:
//   'prompt'  → ask before every gated SSH call (default).
//   'session' → ask once, then auto-allow that tool for the rest of the session.
//   'auto'    → run gated SSH tools without prompting.
// The read-only SSH tools (ssh_read_file / ssh_list_dir) are never gated.
export type SshApprovalMode = 'prompt' | 'session' | 'auto'

export interface SessionSettings {
  provider: ProviderName
  modelId: string
  level: ThinkingLevel
  mode: AgentMode
  accountId?: string
  // Response style (ADR 0046). Built-in style id (style/styles.ts) the session
  // replies in; undefined = default. `responseStyleNoMarkdown` strips markdown
  // from output (stacks on a style or applies alone). Sessions only.
  responseStyle?: string
  responseStyleNoMarkdown?: boolean
  // SSH tool approval mode (ADR 0064 P2). Undefined = 'prompt' (ask every call).
  sshApprovalMode?: SshApprovalMode
}

// One ordered slice of an assistant turn (ADR 0032). Either a run of reply text
// or a single step (tool/plan/note/thinking). The array order IS the timeline —
// no character offsets. Subagent steps nest under their parent step's `children`.
export type SessionMessagePart = { kind: 'text'; text: string } | SessionStep

// One bulk-loaded memory file or custom agent in the context-window breakdown.
// `chars` is the raw char length the engine measured for that item so the UI can
// list it (÷4 ≈ tokens). Used for the expandable MEMORY FILES / CUSTOM AGENTS
// sections of the usage panel (Claude Code `/context` style).
export interface ContextItemSize {
  // Workspace-relative path (memory file) or agent/skill name.
  label: string
  chars: number
}

// Per-segment char sizes of the turn's assembled prompt (char/4 ≈ tokens),
// itemised the way Claude Code's `/context` reports it. All fields are OPTIONAL:
// the legacy shape was `{ system, tools, history }`, so a reloaded message may
// carry only those — the UI reads each field defensively. `system`/`tools` are
// kept for that backward-compat read; the new runs populate the richer fields.
export interface ContextChars {
  // Base resolved system prompt (agent body or params.systemPrompt), no append.
  systemPrompt?: number
  // Appended instruction blocks OTHER than the itemised bulk-load sections
  // (MCP preference nudge, rules, response style, VERIFY, plan-mode, …).
  instructions?: number
  // JSON size of the built-in tool definitions (everything not `mcp__*`).
  systemTools?: number
  // JSON size of the bridged MCP tool definitions (`mcp__<id>__*`).
  mcpTools?: number
  // Bulk-loaded `<available_agents>` block (name + description per agent).
  customAgents?: number
  // Bulk-loaded `<available_skills>` block (name + description per skill).
  skills?: number
  // Bulk-loaded `<wiki_index>` block — the wiki table of contents (ADR 0073).
  wiki?: number
  // Bulk-loaded `<memory>` block — durable facts, one line each (ADR 0073).
  memory?: number
  // Bulk-loaded `<project_context_files>` block (CLAUDE.md / AGENTS.md content).
  memoryFiles?: number
  // Replayed history (prior messages + the pending prompt, incl. tool I/O).
  history?: number
  // Legacy aggregate fields (pre-itemisation). Kept so a message persisted with
  // the old `{ system, tools, history }` shape still type-checks on reload.
  system?: number
  tools?: number
  // Itemised lists for the expandable usage-panel sections.
  memoryFilesList?: ContextItemSize[]
  customAgentsList?: ContextItemSize[]
  skillsList?: ContextItemSize[]
  wikiList?: ContextItemSize[]
  memoryList?: ContextItemSize[]
}

// User-attached file/image on a message. Images carry an inline `url` (a
// base64 `data:` URL) so the preview survives a JSONL reload and so the runtime
// can rebuild an image content block for the model. Mirrors the UI
// SessionAttachment (apps/desktop/ui-next/types/index.ts) — kept structurally in sync.
export interface SessionAttachment {
  id: string
  name: string
  type: 'file' | 'image'
  size?: string
  mime?: string
  url?: string
  // Basename of the externalized attachment file under the session's `attachments/`
  // dir (~/.awog/sessions/{id}/attachments/{storedFile}). Present IFF the image/PDF
  // bytes were moved out of the inline base64 `url` at the JSONL PERSISTENCE boundary
  // (ADR 0062 optional phase). This is a storage-layer detail: sessions/jsonl.ts drops
  // `url` from the persisted line when it sets `storedFile`, and restores `url` from
  // the stored file on read — so runtime/context-builder + the UI always see a
  // fully-populated `url` and never observe `storedFile`.
  storedFile?: string
  // UTF-8 text content of a text-based file (or a large pasted-text block). The
  // runtime delivers this to the model as a delimited text block (buildContext);
  // the UI also uses it for the in-app text preview. Absent for images (which use
  // `url`) and for binary files (which carry `path` instead).
  preview?: string
  // Absolute on-disk path of the source file. Carried for binary / document
  // attachments that have no inline `preview` text: the runtime injects a
  // reference line naming the file (+ path) so the model knows it exists and can
  // Read it with a tool when it sits inside the working directory. Also set for
  // PDFs alongside `url` (base64) so the Anthropic path can send the document AND
  // the model can Read the on-disk copy.
  path?: string
  width?: number
  height?: number
}

export interface SessionMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  agentId?: string
  text: string
  at: string
  modeAtSend?: AgentMode
  // User attachments on a `user` message. Persisted so a JSONL reload keeps the
  // image preview, and so resume rebuilds the image content block for the model
  // (ADR 0029 resume = rebuild Context from history each turn).
  attachments?: SessionAttachment[]
  // Metadata persisted so UI re-hydrate from JSONL keeps assistant features
  // (markdown rendering, latency badge, model name, token counters).
  startedAt?: number
  completedAt?: number
  // Total ms this turn was PARKED on human input (AskUserQuestion / permission
  // prompt). The UI subtracts it from the displayed elapsed so the figure
  // reflects working time, not how long the user took. Persisted so a reload
  // keeps the corrected number. See docs/features/session-steer-queue.md.
  waitingMs?: number
  modelUsed?: string
  // Account that ran this assistant turn (ADR 0054 — Activity cost attribution).
  // ONLY the account id (no token/secret). Optional + back-compat: legacy turns
  // persisted before this field reload without it; the Activity rollup then falls
  // back to the session's current accountId. Written at finalize from the run's
  // resolved SessionSettings.accountId.
  accountId?: string
  // cacheReadTokens/cacheWriteTokens are the Anthropic prompt-cache buckets.
  // Optional for back-compat: messages persisted before this field shipped reload
  // without them (treated as 0 by the context-window display).
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    // Cost of THIS turn in USD, computed at finalize from usage + modelUsed via
    // activity/pricing.ts (single source of truth). Persisted so the session's
    // cumulative cost stays stable even if the price table changes later. Absent
    // when the model has no known price (UI shows "n/a", not a wrong number).
    costUsd?: number
    // Per-segment char sizes of the turn's assembled prompt — lets the usage
    // panel itemise the context window the way Claude Code's `/context` does
    // (System prompt / Instructions / System tools / MCP tools / Custom agents /
    // Skills / Memory files / Messages) instead of one opaque "Other". char/4 ≈
    // tokens. Every field is OPTIONAL so a JSONL reload of a message persisted
    // before this richer shape shipped (legacy `{ system, tools, history }`)
    // still parses — the UI falls back per-field.
    contextChars?: ContextChars
  }
  // True when the assistant turn was cut short (user Stop / error / crash) and
  // only a partial reply was persisted. Mirrors the UI SessionMessage.canceled.
  canceled?: boolean
  // Set when the turn failed (provider `error` stop or a thrown runtime/network
  // error). `message` is the human-readable cause shown in the UI error alert.
  // Persisted so a reload still surfaces the failure (+ retry) instead of an
  // empty reply. Mutually exclusive with a successful completion.
  error?: { message: string }
  // Tool/plan/thinking/todo steps of an assistant turn. Persisted so a re-hydrate
  // from JSONL restores the plan card, the "ran N commands…" cluster, etc. — they
  // were live-only before and vanished on app restart. Stored flat as emitted
  // (subagent children carry `parentId`); the UI re-nests them on load.
  steps?: SessionStep[]
  // Ordered timeline of the assistant turn (ADR 0032): reply-text runs interleaved
  // with steps, in arrival order, subagent steps nested. Authoritative when present
  // — UI renders this directly; when absent (legacy message / live stream before
  // finalize) the UI derives the order from `text` + `steps`. Built + persisted by
  // sessions.send-message; never carries `textOffset`.
  parts?: SessionMessagePart[]
}

// Context-compaction checkpoint (ADR 0047). Mirrors Pi's CompactionResult shape.
// When set, the runtime feeds the model `summary` + every message from
// `firstKeptMessageId` onward (older turns are summarised, not replayed). The UI
// keeps the full transcript visible and renders a summary marker at the cut.
// Only the LATEST checkpoint is kept (a later compaction subsumes the prior one).
export interface SessionCompaction {
  summary: string
  firstKeptMessageId: string
  // Estimated context tokens before this compaction (for the marker hint).
  tokensBefore: number
  at: string
}

// Per-session spend caps. `limitUsd` is a SOFT cap (UI warning only). The rest are
// HARD caps enforced sidecar-side: a turn is refused once cumulative cost reaches
// `hardLimitUsd`, and a turn is stopped once it makes more than `maxToolCalls` tool
// calls or runs longer than `maxWallclockMs`. Closes the "budget per task" invariant.
// All optional; absent = no budget. Mirrors the UI SessionBudget.
export interface SessionBudget {
  limitUsd?: number
  hardLimitUsd?: number
  maxToolCalls?: number
  maxWallclockMs?: number
}

// Files/notes pinned to a session, re-fed into EVERY turn as a <pinned_context>
// block (distinct from one-shot attachments and global/project rules). `files` are
// workspace-relative paths read fresh per turn (path-sanitized); `notes` is free
// text. Mirrors the UI PinnedContext. Round-trips through sessions.upsert.
export interface PinnedContext {
  files?: string[]
  notes?: string
  // Reusable notes applied to the session as discrete toggled units (from the UI's
  // preset/recent library) — each re-fed as its own <notes> entry, distinct from the
  // free-text `notes`. Stored as text so they're self-contained.
  notePresets?: string[]
}

export interface Session {
  id: string
  title: string
  projectId: string | null
  createdAt: string
  updatedAt: string
  pinned?: boolean
  invitedAgentIds: string[]
  messages: SessionMessage[]
  pendingAgentIds: string[]
  settings: SessionSettings
  disabledTools?: string[]
  mcpServerIds?: string[]
  // Files/notes re-fed into every turn as <pinned_context> (see PinnedContext).
  pinnedContext?: PinnedContext
  // Absolute path of a folder dragged into the session; becomes the runtime tools'
  // cwd (forwarded as sessions.sendMessage params.workspacePath, takes precedence
  // over the project path). A <workspace_tree> orientation block is injected.
  workspaceFolder?: string
  // Soft + hard spend caps for this session (see SessionBudget).
  budget?: SessionBudget
  // Fork lineage: the session this one was forked from (its id) and the message
  // (id) it forked at. Set by sessions.fork / upsert; drives the fork-tree graph.
  parentSessionId?: string
  forkFromMessageId?: string
  // Task this session was opened to discuss (ADR 0055). When set, buildContext
  // injects a <linked_task> block (the task's latest output + a trace summary)
  // each turn so the agent can reason about the task's results. Absent for a
  // normal chat session. The reverse link (task → its discussion sessions) is
  // derived by filtering sessions on aboutTaskId — not stored on the task.
  aboutTaskId?: string
  // SSH host this session was opened to work with (ADR 0064, P1). When set,
  // buildContext injects a <linked_ssh_host> block (the host's connection info +
  // metadata, NO secrets) each turn so the agent knows which machine the user is
  // asking about. Absent for a normal chat. The reverse link (host → its sessions)
  // is derived by filtering sessions on aboutSshHostId — not stored on the host.
  aboutSshHostId?: string
  // GitHub issue/PR this session was opened from ("New session" on an issue/PR
  // row). Full github.com URL — a back-reference surfaced in the UI; not injected
  // into the model context. Absent for a normal chat.
  aboutGhUrl?: string
  // Latest context-compaction checkpoint (ADR 0047), or absent if never compacted.
  compaction?: SessionCompaction
  // The session's CURRENT work checklist — the authoritative copy, written both by
  // the model's TodoWrite (runtime ToolFilter.todoSink) and by the user's own edits
  // (sessions.updateTodos). Re-injected as a <session_checklist> block on every turn
  // (sessions/todo-context.ts) because the model otherwise only sees its own last
  // TodoWrite in context and would silently overwrite a user edit. The transcript
  // still records each TodoWrite step as history; this is only the current state.
  // Absent for a session that never had a checklist.
  todos?: TodoItem[]
  // Claude Agent SDK session id (ADR 0058, Anthropic path only). Set once the
  // first SDK turn runs and updated whenever the SDK rotates it; the next turn
  // passes it as `resume` so the SDK restores conversation history + compaction
  // from its own store. Absent for Pi-only (non-Anthropic) sessions. JSONL still
  // records the messages for UI display — this is only the SDK's resume handle.
  sdkSessionId?: string
}

// Lightweight list-row projection of a Session WITHOUT `messages` (ADR 0048).
// `sessions.list` returns these from the per-file SessionHeader line (ADR 0061
// single-file storage) so app startup reads KB of headers instead of loading every
// transcript into RAM. Open a session → `sessions.get` for the full Session with
// messages.
// Resting (persisted) status of a session, derived from its last message so the
// list can badge awaiting/error/done WITHOUT loading the transcript. Never
// 'streaming' — that is a live-only state the UI tracks from stream events; a
// finalized/reloaded session is one of these four. Mirrors the UI SessionStatus
// minus 'streaming'.
export type SessionRestingStatus = 'idle' | 'done' | 'awaiting' | 'error'

export interface SessionSummary {
  id: string
  title: string
  projectId: string | null
  createdAt: string
  updatedAt: string
  pinned?: boolean
  // Resting status for the list badge (ADR 0048) — derived from the last message
  // the same way the UI derives it on open, so an un-opened session shows its true
  // done/awaiting/error state instead of a placeholder.
  status: SessionRestingStatus
  invitedAgentIds: string[]
  pendingAgentIds: string[]
  settings: SessionSettings
  disabledTools?: string[]
  mcpServerIds?: string[]
  // Task this session discusses (ADR 0055) — surfaced on the list row so the UI
  // can badge / navigate without loading the full transcript. Mirrors
  // Session.aboutTaskId.
  aboutTaskId?: string
  // SSH host this session works with (ADR 0064) — mirrors Session.aboutSshHostId.
  aboutSshHostId?: string
  // GitHub issue/PR this session was opened from — mirrors Session.aboutGhUrl.
  aboutGhUrl?: string
  // Fork parent (its session id) — surfaced on the list row so the fork-tree graph
  // can be built from sessions.list without loading every transcript. Mirrors
  // Session.parentSessionId.
  parentSessionId?: string
  // True when a compaction checkpoint exists — lets the UI badge it without
  // loading the transcript.
  hasCompaction?: boolean
  // Count for the list badge ("N msg"). Maintained incrementally on the index;
  // exact after a fold-based rebuild.
  messageCount: number
  // Trimmed preview of the last message text, for list subtitles.
  lastPreview?: string
}

// Line 1 of a session's {id}.jsonl in the single-file storage model
// (craft-parity core, built alongside the event-sourced store — see
// sessions/jsonl.ts). Carries EVERY persistent Session field EXCEPT `messages`
// (which live on lines 2+, one per line) PLUS the pre-computed list fields, so
// the session list loads from KB of headers instead of folding every transcript.
// `Omit<Session, 'messages'>` keeps this in lockstep with Session — any new
// persistent field on Session flows through automatically.
export interface SessionHeader extends Omit<Session, 'messages'> {
  // Number of messages on lines 2+ (pre-computed for the list badge).
  messageCount: number
  // Sanitized first ~140 chars of the first user message, for the list subtitle.
  preview?: string
  // Resting status derived from the last message (idle/done/awaiting/error) — the
  // same derivation as the event-sourced store's summarize(), so an un-opened
  // session badges its true state without loading the transcript.
  status: SessionRestingStatus
  // Trimmed preview of the LAST message text, for list subtitles (mirrors
  // SessionSummary.lastPreview).
  lastPreview?: string
}

// ─── Session steps (tool use / thinking) ───────────────────────────────────
// Mirrors apps/desktop/ui-next/types/index.ts SessionStep. Sidecar emits these via
// session.step notifications when the SDK reports tool_use / tool_result.

export type SessionStepTool =
  | 'read'
  | 'write'
  | 'edit'
  | 'save'
  | 'search'
  | 'find-files'
  | 'terminal'
  | 'task'

export type SessionStepStatus = 'running' | 'done' | 'error'

// Plan step lifecycle (ExitPlanMode). pending → user approves/rejects in the UI.
export type PlanStatus = 'pending' | 'approved' | 'rejected'

// A single entry in the model's TodoWrite checklist (the agent's live task list).
export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export interface TodoItem {
  content: string
  status: TodoStatus
}

// AskUserQuestion (kind === 'question'): the model pauses the turn to ask the
// user 1–4 multiple-choice questions. See docs/features/ask-user-question.md.
export interface SessionQuestionOption {
  label: string
  description?: string
}
export interface SessionQuestion {
  // Short chip label shown on the tab (≤ ~12 chars).
  header: string
  question: string
  options: SessionQuestionOption[]
  multiSelect: boolean
}
// One answered question: the option label(s) the user picked (or their custom
// "Other" text). Keyed back to its question by `header`.
export interface SessionQuestionAnswer {
  header: string
  selected: string[]
}

export type SessionStepDetail =
  // Edit/MultiEdit: `diff` is a unified diff (git-style) the UI renders in
  // split/unified mode; `content` (optional) is the full file after the edit,
  // shown in a File view toggle.
  | { kind: 'diff'; path: string; diff: string; content?: string; language?: string }
  | { kind: 'file'; path: string; content: string; language?: string }
  | { kind: 'list'; items: { label: string; path?: string; snippet?: string }[] }
  | { kind: 'terminal'; command: string; output?: string; exitCode?: number }
  | { kind: 'text'; content: string }

export interface SessionStep {
  id: string
  kind: 'tool' | 'group' | 'thinking' | 'note' | 'plan' | 'question' | 'steer'
  tool?: SessionStepTool
  label: string
  target?: string
  description?: string
  additions?: number
  deletions?: number
  pathHint?: string
  status?: SessionStepStatus
  detail?: SessionStepDetail
  // Plan step (kind === 'plan', emitted from an ExitPlanMode tool call): the
  // proposed steps + optional rationale + approval status the UI renders as a
  // plan card with Approve/Reject. Mirrors the UI SessionStep plan fields.
  // planMarkdown holds the RAW plan markdown so the UI can render it as a
  // document (headers/lists/bold preserved); planItems/planRationale are the
  // legacy flattened form kept as a fallback for older persisted steps.
  planMarkdown?: string
  planItems?: string[]
  planStatus?: PlanStatus
  planRationale?: string
  // Todo step (kind === 'note', emitted from a TodoWrite tool call): the live
  // checklist the UI renders inline. Mirrors the UI SessionStep.todos field.
  todos?: TodoItem[]
  // Question step (kind === 'question', emitted from an AskUserQuestion tool
  // call): the questions the model asked (from the call INPUT) and — once the
  // user answers — their chosen answers (filled on tool_execution_end). The UI
  // renders the interactive card while `answers` is unset + status 'running',
  // then a read-only record. See docs/features/ask-user-question.md.
  questions?: SessionQuestion[]
  answers?: SessionQuestionAnswer[]
  // Steer step (kind === 'steer'): the user's mid-turn instruction injected via
  // getSteeringMessages. Holds the steered text so the UI renders it inline as a
  // user-note in the agent timeline at the point it landed. See
  // docs/features/session-steer-queue.md.
  steerText?: string
  // Subagent grouping: when set, this step ran inside the Task step with this
  // tool_use_id. UI nests the step under that parent instead of rendering
  // top-level. Source: SDK's `parent_tool_use_id` on stream_event/assistant/user.
  parentId?: string
  // Character offset into the assistant `text` at which this tool fired (= length
  // of the reply streamed so far). Stamped on first sighting and PERSISTED so a
  // JSONL reload can re-interleave step rows with the reply text in chronological
  // order — without it, reloaded steps default to end-of-text and the whole reply
  // collapses above the tool cluster (the post-tool answer loses its place). The
  // UI store mirrors the same value for live turns. Unset for nested subagent steps.
  textOffset?: number
}

// ─── Project ───────────────────────────────────────────────────────────────
// Mirror of UI shape (apps/desktop/ui-next/types/index.ts). Stored as plain JSON
// at ~/.awog/projects/<id>.json — see ADR 0012.

// Per-project LLM defaults (mirror of UI ProjectLlmDefaults). New sessions in
// this project inherit these instead of the global app defaults.
export interface ProjectLlmDefaults {
  provider: ProviderName
  modelId: string
  // undefined = follow the global thinking level (the UI pins it only when the
  // project intentionally overrides the app default).
  level?: ThinkingLevel
  accountId?: string
  // MCP server whitelist new sessions inherit (mirror of Session.mcpServerIds).
  // undefined = all currently enabled servers.
  mcpServerIds?: string[]
  // Response style (ADR 0046) new sessions inherit (mirror of SessionSettings).
  // undefined = "Normal" (no style). `responseStyleNoMarkdown` strips markdown.
  responseStyle?: string
  responseStyleNoMarkdown?: boolean
}

export interface Project {
  id: string
  name: string
  path: string
  description: string
  gitRemote: string
  gitBranch: string
  language: string
  createdAt: string
  color?: string
  llmDefaults?: ProjectLlmDefaults
  // GitHub (gh CLI) account login this project authenticates as — for git
  // push/fetch/pull AND the GH Issues/PR tabs. '' = active gh account; absent =
  // inherit the app-level default (settings.githubAccount). A concrete login pins.
  githubAccount?: string
}

// ─── Skill ─────────────────────────────────────────────────────────────────
// Stored as a folder containing SKILL.md (YAML frontmatter + markdown body).
// Single editable home `.awog`, two tiers (ADR 0035):
//
//   global  → ~/.awog/skills/<id>/SKILL.md             (applies everywhere)
//   project → {project.path}/.awog/skills/<id>/SKILL.md (that project only)
//
// `.claude`/`.agents` skill folders are NO LONGER scanned as live tiers — they
// are one-time import sources (see migration/ + config-import-assistant).

export type SkillSource = 'global' | 'project'

export interface Skill {
  id: string
  source: SkillSource
  projectId?: string
  name: string
  description: string
  body: string
  globs?: string[]
  alwaysAllow?: string[]
  icon?: string
  requiredSources?: string[]
}

// ─── MCP Server ────────────────────────────────────────────────────────────
// Mirror of UI shape. Persistence is config-only; runtime fields (status,
// tools, resources, lastError) live in mcp/manager.ts in-memory state.
// See ADR 0014.

export type McpTransport = 'stdio' | 'http' | 'sse'
export type McpTrust = 'allow' | 'prompt' | 'deny'
export type McpStatus = 'running' | 'starting' | 'idle' | 'error' | 'disabled'

export interface McpTool {
  name: string
  description: string
}

export interface McpResource {
  uri: string
  mime: string
}

// One line of the connection-test activity log (ADR 0060 P5 — the Tools section's
// live progress console). `info` = an AWOG step ("Spawning process…", "Handshake
// complete — 12 tools"); `stderr` = a raw line the MCP server printed to stderr;
// `error` = the failure that ended the run. Invariant 1: a step message NEVER
// contains an injected token / header value / env secret (only the command, url,
// and counts — all of which the UI already shows elsewhere).
export type SourceLogLevel = 'info' | 'stderr' | 'error'
export interface SourceLogLine {
  level: SourceLogLevel
  message: string
}
export type SourceLog = (line: SourceLogLine) => void

// Optional auth probe: a read-only tool call the connection Test runs AFTER the
// MCP handshake to verify the token actually authenticates (the handshake +
// tools/list alone never exercise auth). Pick a tool that reads authenticated
// data — a public/anonymous tool would pass even with a bad token.
export interface McpHealthCheck {
  tool: string
  args?: Record<string, unknown> | undefined
}

export interface McpServerConfig {
  id: string
  name: string
  description: string
  transport: McpTransport
  command?: string | undefined
  args?: string[] | undefined
  env?: Record<string, string> | undefined
  cwd?: string | undefined
  url?: string | undefined
  headers?: Record<string, string> | undefined
  enabled: boolean
  autoStart: boolean
  timeoutMs: number
  trust: McpTrust
  deniedTools?: string[] | undefined
  healthCheck?: McpHealthCheck | undefined
}

export interface McpServerSnapshot extends McpServerConfig {
  status: McpStatus
  tools: McpTool[]
  resources: McpResource[]
  lastError?: string | undefined
  lastStartedAt?: string | undefined
}

// ─── Source ──────────────────────────────────────────────────────────────────
// Successor to McpServerConfig (kept above for compat). A Source is an external
// data connection with three kinds — mcp | api | local — stored per-folder at
// ~/.awog/sources/<slug>/config.json. See ADR 0060 + connections-sources-model.
//
// Hand-written mirror of the Zod SourceConfigSchema (sources/schema.ts); the two
// must stay structurally identical (the store parses with the Zod schema and
// returns the data as this type, so tsc enforces compatibility). No autoStart —
// lifecycle is a lazy pool, and live status is captured by connectionStatus.

export type SourceType = 'mcp' | 'api' | 'local'
export type SourceTrust = 'allow' | 'prompt' | 'deny'
export type SourceConnectionStatus =
  | 'connected'
  | 'needs_auth'
  | 'failed'
  | 'untested'
  | 'local_disabled'

export interface SourceHealthCheck {
  tool: string
  args?: Record<string, unknown> | undefined
}

export interface McpSourceBlock {
  transport?: 'http' | 'sse' | 'stdio' | undefined
  url?: string | undefined
  authType?: 'oauth' | 'bearer' | 'none' | undefined
  clientId?: string | undefined
  headers?: Record<string, string> | undefined
  headerNames?: string[] | undefined
  command?: string | undefined
  args?: string[] | undefined
  env?: Record<string, string> | undefined
  cwd?: string | undefined
}

export interface ApiSourceBlock {
  baseUrl: string
  authType: 'bearer' | 'header' | 'query' | 'basic' | 'oauth' | 'none'
  headerName?: string | undefined
  headerNames?: string[] | undefined
  queryParam?: string | undefined
  authScheme?: string | undefined
  defaultHeaders?: Record<string, string> | undefined
  testEndpoint?:
    | {
        method: 'GET' | 'POST'
        path: string
        body?: Record<string, unknown> | undefined
        headers?: Record<string, string> | undefined
      }
    | undefined
  renewEndpoint?:
    | {
        path: string
        method?: 'GET' | 'POST' | undefined
        body?: Record<string, unknown> | undefined
        headers?: Record<string, string> | undefined
        tokenField?: string | undefined
        expiresInField?: string | undefined
        fallbackTtlSecs?: number | undefined
      }
    | undefined
  oauth?:
    | {
        authorizationUrl: string
        tokenUrl: string
        clientId: string
        clientSecret?: string | undefined
        scopes?: string[] | undefined
        audience?: string | undefined
        extraParams?: Record<string, string> | undefined
      }
    | undefined
  googleService?:
    | 'gmail'
    | 'calendar'
    | 'drive'
    | 'docs'
    | 'sheets'
    | 'youtube'
    | 'searchconsole'
    | undefined
  googleScopes?: string[] | undefined
  googleOAuthClientId?: string | undefined
  googleOAuthClientSecret?: string | undefined
  slackService?: 'messaging' | 'channels' | 'users' | 'files' | 'full' | undefined
  slackUserScopes?: string[] | undefined
  microsoftService?:
    | 'outlook'
    | 'microsoft-calendar'
    | 'onedrive'
    | 'teams'
    | 'sharepoint'
    | undefined
  microsoftScopes?: string[] | undefined
}

export interface LocalSourceBlock {
  path: string
  format?: string | undefined
}

// Fields shared by every source kind.
export interface SourceConfigBase {
  id: string
  slug: string
  name: string
  provider: string
  enabled: boolean
  icon?: string | undefined
  tagline?: string | undefined
  description?: string | undefined
  isAuthenticated?: boolean | undefined
  connectionStatus?: SourceConnectionStatus | undefined
  connectionError?: string | undefined
  lastTestedAt?: number | undefined
  createdAt?: number | undefined
  updatedAt?: number | undefined
  timeoutMs: number
  deniedTools?: string[] | undefined
  trust: SourceTrust
  healthCheck?: SourceHealthCheck | undefined
}

export interface McpSource extends SourceConfigBase {
  type: 'mcp'
  mcp: McpSourceBlock
}

export interface ApiSource extends SourceConfigBase {
  type: 'api'
  api: ApiSourceBlock
}

export interface LocalSource extends SourceConfigBase {
  type: 'local'
  local: LocalSourceBlock
}

export type SourceConfig = McpSource | ApiSource | LocalSource

// ─── Agent ─────────────────────────────────────────────────────────────────
// Stored as a single `.md` file (or `<id>/AGENT.md` folder) with YAML
// frontmatter + markdown body, format-compatible with Claude Code SDK subagent
// convention. Single editable home `.awog`, two tiers (ADR 0035):
//
//   global  → ~/.awog/agents/<id>.md            (applies everywhere)
//   project → {project.path}/.awog/agents/<id>.md (that project only)
//
// Frontmatter is interchangeable with Claude Code subagents. AWOG extends with
// `role` for the workspace agent picker; a no-op for vanilla Claude Code but
// harmless. systemPrompt = body. See ADR 0015. `.claude`/`.agents` agents are
// import sources only (migration/ + config-import-assistant), not live tiers.

export type AgentSource = 'global' | 'project'

export interface Agent {
  id: string
  source: AgentSource
  projectId?: string
  name: string
  description: string
  // LLM provider this agent runs on (ADR 0026). Default 'anthropic'. The model
  // below must belong to this provider.
  provider: ProviderName
  // Optional per-agent account (id in credentials.json). Undefined = the
  // provider's active account. Falls back to active if the id no longer exists.
  accountId?: string
  model: string
  systemPrompt: string
  role: string
  // Claude Code subagent `tools` field — restrict the SDK toolset for this
  // agent. Empty/undefined means "inherit session's full toolset" (no
  // restriction). When set, sidecar passes to `runStream({ allowedTools })`.
  tools?: string[]
  // Per-agent MCP server whitelist (replacement for deprecated Context
  // Providers feature — see ADR 0016). Empty/undefined means "inherit the
  // session's MCP set" (no per-agent filtering). When set, sidecar intersects
  // with the session-level mcpServerIds before forwarding to the SDK.
  mcpServerIds?: string[]
}

// ─── Workflow ────────────────────────────────────────────────────────────────
// DAG template persisted as plain JSON at ~/.awog/workflows/<id>.json (ADR 0024
// D-3). Mirror of UI shape (apps/desktop/ui-next/types/index.ts). A node carries the
// full agent identity tuple (id + source + projectId) so the engine can resolve
// it via loadAgent at execution time (D-11).

// Machine-readable quality verdict a gate node produces (ADR 0056). Distinct
// from RunStatus: a gate run that reports `fail` still COMPLETED (it did its
// job — found the problems). Parsed from a ```verdict``` block in the output.
export type Verdict = 'pass' | 'fail'

// Turns a node into a quality checkpoint with a loop-back directive (ADR 0056).
// On verdict `fail`, the engine reruns `onFailTarget` (a transitive ancestor —
// edges stay acyclic; the loop is a directive, not a cycle) with this gate's
// output as the instruction, up to `maxIterations` times. After that (or when
// `auto` is false, or the verdict can't be parsed) it escalates to a human via
// `waiting_approval`.
export interface NodeGate {
  onFailTarget: string
  maxIterations: number
  auto: boolean
}

export interface WorkflowNode {
  id: string
  agentId: string
  // Agent identity tuple — agentSource/agentProjectId are optional so legacy
  // workflows (pre-D-11) still parse; node-runner falls back to a best-effort
  // lookup-by-id when source is absent.
  agentSource?: AgentSource
  agentProjectId?: string
  skillId: string
  x: number
  y: number
  outputs: string[]
  approval: boolean
  // Gate config (ADR 0056). Absent = an ordinary node (no verdict, no loop).
  gate?: NodeGate
}

export interface WorkflowEdge {
  from: string
  to: string
}

// Where a workflow lives (ADR 0024 follow-up). 'global' = ~/.awog/workflows
// (shared across projects); 'project' = {project.path}/.awog/workflows (travels
// with the repo, git-trackable). Like Skills, source/projectId are derived from
// the on-disk location, NOT persisted inside the JSON.
export type WorkflowSource = 'global' | 'project'

export interface Workflow {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  // Location tags — set when listing/loading; stripped before writing.
  source?: WorkflowSource
  projectId?: string
}

// ─── Task (workflow instance) ────────────────────────────────────────────────
// A Task is an instance of a Workflow bound to a Project. Persisted event-sourced
// as JSONL at ~/.awog/tasks/<id>/events.log with a derived task.json snapshot
// (ADR 0024 D-2). Mirror of UI shape (apps/desktop/ui-next/types/index.ts).

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_connection'
  | 'paused'
  | 'completed'
  | 'failed'

export type PhaseStatus =
  | 'pending'
  | 'running'
  | 'waiting_approval'
  | 'waiting_connection'
  | 'completed'
  | 'failed'

export type RunStatus = 'running' | 'waiting_approval' | 'completed' | 'superseded' | 'failed'

// `connectionId` = the mcpServerId of the connection the task uses to reach its
// source. Optional; the engine unions that MCP server into every node. Token
// never lives here — only the id (ADR 0025, simplified: no service tag/tier).
// `session` (ADR 0055) = the task was spawned from a chat session; `sessionId` is
// the session's canonical id and `messageId` the message it was kicked off from
// (both let the UI navigate back). The reverse link (session → its spawned tasks)
// is NOT stored — it is derived by filtering tasks on source.sessionId.
export type TaskSource =
  | { type: 'github'; repo: string; issueNumber: number; url: string; connectionId?: string }
  | { type: 'jira'; key: string; connectionId?: string }
  | { type: 'manual' }
  | { type: 'session'; sessionId: string; messageId?: string; connectionId?: string }

export interface TraceNode {
  id: string
  type: 'agent' | 'subagent' | 'tool' | 'thinking' | 'todo'
  name?: string
  model?: string
  purpose?: string
  tool?: string
  input?: string
  result?: string
  text?: string
  agentName?: string
  agentId?: string
  // Todo node (type === 'todo', from a TodoWrite tool call): the live checklist.
  todos?: TodoItem[]
  duration: string | null
  startedAt?: string
  status?: 'running'
  children?: TraceNode[]
}

export interface TaskMessage {
  role: 'user' | 'agent'
  text: string
  at: string
}

// Token usage + cost-attribution metadata for one task node-run (ADR 0054).
// Persisted so the Activity rollup can attribute a task's spend to the right
// account/model without re-running it. accountId is ONLY the id (no secret).
// Optional for back-compat: runs persisted before this shipped reload without it
// and are skipped by the rollup (task usage is best-effort).
export interface TaskRunUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  model: string
  provider: ProviderName
  accountId?: string
}

export interface TaskRun {
  version: number
  status: RunStatus
  output: string
  trace: TraceNode[]
  messages: TaskMessage[]
  duration: string | null
  approvedBy?: 'human' | 'auto'
  approvedAt?: string
  // 'auto-loop' = this run was dispatched by a gate's auto loop-back (ADR 0056);
  // counting these on the loop target gives the iteration number (restart-safe).
  triggeredBy?: 'rerun' | 'resume-connection' | 'auto-loop'
  // Quality verdict (ADR 0056) — only set on gate-node runs. Drives the engine's
  // loop-back / escalate decision; absent on ordinary nodes.
  verdict?: Verdict
  // Token usage of this run (ADR 0054). Absent until the run finishes (or for
  // legacy runs). The completion time for the Activity day-bucket is the run's
  // run.status='completed' event timestamp.
  usage?: TaskRunUsage
}

export interface TaskPhase {
  nodeId: string
  status: PhaseStatus
  skillName: string
  runs: TaskRun[]
}

export interface Task {
  id: string
  title: string
  projectId: string
  source: TaskSource
  description: string
  workflowId: string
  status: TaskStatus
  // Singular currentNodeId kept for back-compat; with the parallel scheduler the
  // authoritative "what is running" is derived from per-phase status.
  currentNodeId: string | null
  waitingApproval: string | null
  // Deferred (ADR 0010) — always null in v1; kept so the producer is additive.
  waitingConnection: unknown | null
  createdAt: string
  // Snapshot of the workflow DAG at creation time so editing the workflow later
  // never mutates a running task (ADR 0024 risk #4). Optional for legacy reads.
  workflowSnapshot?: Workflow
  // Snapshot of the `commitCoAuthor` Git setting (UI) at creation time. When
  // true the per-phase auto-commit appends `Co-Authored-By: AWOG …`. Optional
  // for legacy tasks — undefined is treated as enabled.
  commitCoAuthor?: boolean
  // Snapshot of the remaining auto-commit Git settings (UI) at creation time.
  // Settings live in the renderer (localStorage) so they travel in tasks.create
  // and are persisted here for restart/rerun. Optional for legacy tasks:
  //   autoCommitPerPhase undefined → enabled (commit each phase)
  //   autoCommitScope undefined    → 'workspace'
  //   autoCommitMessageTemplate undefined → node-runner default template
  autoCommitPerPhase?: boolean
  autoCommitScope?: 'workspace' | 'artifacts-only'
  autoCommitMessageTemplate?: string
  phases: Record<string, TaskPhase>
}

// ─── Hooks ─────────────────────────────────────────────────────────────────
// User-defined shell commands run when a lifecycle event fires (ADR 0032).
// Persisted per-file JSON, two tiers (D-3): global ~/.awog/hooks/<id>.json +
// project {project.path}/.awog/hooks/<id>.json. source/projectId are location-
// derived (NOT stored in the file), mirroring Workflows. Mirror of UI shape
// (apps/desktop/ui-next/types/index.ts).

export type HookEvent =
  | 'task.before-start'
  | 'task.after-complete'
  | 'phase.before-run'
  | 'phase.after-run'
  | 'phase.before-approve'
  | 'phase.after-approve'
  | 'artifact.before-write'
  | 'artifact.after-write'
  | 'agent.before-prompt'
  | 'agent.after-response'
  | 'tool.before-call'
  | 'tool.after-call'
  | 'mcp.server-error'
  | 'session.reset'

export type HookRunMode = 'blocking' | 'background'

// Single editable home `.awog`, two tiers (ADR 0035). Project tiers run before
// global ("ưu tiên project").
//   global  → ~/.awog/hooks/*.json            (editable)
//   project → {project}/.awog/hooks/*.json     (editable)
// Claude Code settings.json hooks are an import source only (migration/), not a
// live tier.
export type HookSource = 'global' | 'project'

export interface HookRunRecord {
  at: string
  durationMs: number
  exitCode: number
  stderr?: string
}

export interface Hook {
  id: string
  name: string
  description: string
  event: HookEvent
  // Map jsonPath → glob/value filter (AND across keys). Empty = match all.
  matcher: Record<string, string>
  command: string
  // Default '${workspace}' — expanded to the project root by the dispatcher.
  cwd: string
  timeoutMs: number
  runMode: HookRunMode
  enabled: boolean
  // Extra env vars; values may be `secret:KEY` refs resolved via OS keychain.
  env?: Record<string, string>
  // Location tags — set when listing/loading; stripped before writing.
  source?: HookSource
  projectId?: string
  // Whether the hook is allowed to spawn. Global = always true; project-tier =
  // false until the user grants trust (D-8). Runtime-only — never written.
  trusted?: boolean
  // Imported Claude Code hook (claude-*): not editable in AWOG. Dispatched with
  // a Claude-Code-shaped stdin payload so CC hook scripts work.
  readOnly?: boolean
  recentRuns?: HookRunRecord[]
}

// Per-tier scan report (mirrors SkillScanReport) — surfaces which dirs were
// scanned + how many hooks each held, so a misconfigured HOME is diagnosable.
export interface HookScanReport {
  dir: string
  source: HookSource
  found: number
  projectId?: string
}

// Payload contract passed to a hook on stdin + used for matcher/template (D-7).
export interface HookPayload {
  event: HookEvent
  ts: string
  taskId?: string
  nodeId?: string
  sessionId?: string
  // Per-event detail bag (path, toolName, status, …). Matcher keys + `{{...}}`
  // templates resolve against `event.payload.<key>` (and top-level fields).
  payload: Record<string, unknown>
}

// ─── Rules ─────────────────────────────────────────────────────────────────
// User-authored instruction files auto-injected into the agent system prompt
// for sessions + tasks (the AWOG-native analog of CLAUDE.md / .claude/rules).
// Per-file Markdown (YAML frontmatter + body), two tiers like Skills/Hooks:
//   global  → ~/.awog/rules/<id>.md            (applies to every session/task)
//   project → {project.path}/.awog/rules/<id>.md (applies to that project only)
// source/projectId are location-derived (not in the file). The body is appended
// to systemPromptAppend (augments, never replaces, the agent's own prompt).

// Single editable home `.awog`, two tiers (ADR 0035). CLAUDE.md / .claude/rules
// are import sources only (migration/) — NO live injection anymore (supersedes
// ADR 0033 D-4).
//   global  → ~/.awog/rules/*.md            (editable)
//   project → {project}/.awog/rules/*.md     (editable)
export type RuleSource = 'global' | 'project'

export interface Rule {
  id: string
  name: string
  description: string
  // The instruction text injected into the system prompt.
  body: string
  enabled: boolean
  // Glob patterns scoping the rule (ADR 0050). When non-empty, the rule injects
  // only when a path referenced in the current turn matches one of these; empty/
  // absent → always inject (backward-compatible).
  globs?: string[]
  // Location tags — set when listing/loading; stripped before writing.
  source?: RuleSource
  projectId?: string
  // Imported Claude Code file (claude-*): always enabled, not editable in AWOG.
  readOnly?: boolean
}

export interface RuleScanReport {
  dir: string
  source: RuleSource
  found: number
  projectId?: string
}

// ─── Slash Commands ──────────────────────────────────────────────────────────
// User-authored prompt templates invoked from the session composer with `/name`
// (the AWOG-native analog of Claude Code's `.claude/commands/*.md`). Per-file
// Markdown (YAML frontmatter + body); the body is the prompt expanded on send,
// with `$ARGUMENTS` / `$1`…`$9` substituted from what the user types after the
// name. Single editable home `.awog`, two tiers (ADR 0035):
//   global  → ~/.awog/commands/*.md          (editable)
//   project → {project}/.awog/commands/*.md   (editable)
// source/projectId are location-derived (not written into the file).
// `.claude/commands` are an import source only (migration/), not a live tier.
export type CommandSource = 'global' | 'project'

export interface Command {
  // Slug = the name typed after `/`. Subdirectory namespacing uses ':' (a
  // Claude Code `frontend/component.md` → id `frontend:component`).
  id: string
  name: string
  description: string
  // The prompt template. `$ARGUMENTS` / `$1`…`$9` are substituted on send.
  body: string
  // Optional Claude-Code frontmatter passthrough (shown in UI; stored verbatim).
  argumentHint?: string
  allowedTools?: string
  model?: string
  enabled: boolean
  // Location tags — set when listing/loading; stripped before writing.
  source?: CommandSource
  projectId?: string
  // Imported Claude Code command (claude-*): editable in-app (writes back to the
  // source file), flagged so the UI shows a Lock badge + import grouping.
  readOnly?: boolean
}

export interface CommandScanReport {
  dir: string
  source: CommandSource
  found: number
  projectId?: string
}

// ─── Config import (migration) — ADR 0035 / config-import-assistant ──────────
// The 5 config-entity kinds that live under `.awog/` and can be imported from
// `.claude`/`.agents` or bundled into a Project Template.
export type ConfigKind = 'agent' | 'skill' | 'hook' | 'rule' | 'command'

// One importable item discovered in a `.claude`/`.agents` source (NOT yet in
// `.awog`). `targetScope` is where importing would write it.
export interface ImportCandidate {
  kind: ConfigKind
  id: string
  name: string
  // Human label of the source location, e.g. '.claude/agents', 'CLAUDE.md'.
  fromLabel: string
  targetScope: 'global' | 'project'
  projectId?: string
  // True when an entity of this kind+id already exists in the target `.awog`
  // tier — the UI deselects these by default and import skips them.
  alreadyExists: boolean
}

export interface ImportResult {
  imported: { kind: ConfigKind; id: string }[]
  skipped: { kind: ConfigKind; id: string; reason: string }[]
}

// ─── Project Templates — ADR 0036 ────────────────────────────────────────────
// A self-contained bundle of config copied to `~/.awog/templates/<id>/` and
// installed into a project's `.awog/` tiers.
export interface TemplateEntityRef {
  kind: ConfigKind
  id: string
  // Path relative to the bundle root, e.g. 'agents/foo.md', 'skills/bar/SKILL.md'.
  file: string
}

export interface ProjectTemplate {
  id: string
  name: string
  description: string
  createdAt: string
  // Project the template was exported from (informational only).
  sourceProjectId?: string
  entities: TemplateEntityRef[]
}

export interface TemplateInstallResult {
  installed: { kind: ConfigKind; id: string }[]
  skipped: { kind: ConfigKind; id: string; reason: string }[]
}

// Result of fetching one or more template bundles from a remote GitHub folder
// (ADR 0037). `imported` are the bundles written to ~/.awog/templates/;
// `skipped` records bundles left untouched (already exist, duplicate id, etc.).
export interface TemplateFetchResult {
  imported: ProjectTemplate[]
  skipped: { id: string; reason: string }[]
}

// ─── Dashboard usage (Home tile "Activity") ─────────────────────────────────
// Aggregate token-usage figures derived from session JSONL logs for the Home
// dashboard. "Token" per turn = inputTokens + outputTokens + cacheRead + cacheWrite
// (context usage counts cache buckets too). Computed on demand by `dashboard.usage`.
export interface DashboardUsage {
  // Total tokens since local midnight today.
  today: number
  // Total tokens for all of yesterday (local day), for the ↑% delta vs today.
  yesterday: number
  // 12 buckets of 2 hours each over the last 24h, oldest → newest (sparkline).
  buckets: number[]
  // Approximate tokens/minute over the most recent active window.
  ratePerMin: number
}

// ─── Activity (usage + cost) — ADR 0054 ──────────────────────────────────────
// `activity.summary` aggregates token usage across Sessions + Tasks for a time
// range, applies effective per-model prices → cost (USD), and groups by model /
// account / day. Built from the daily usage rollup cache (~/.awog/usage/daily/).
// Provider fields are DISPLAY labels (e.g. "Anthropic"), not the internal id.

export type ActivityRange = '1d' | '7d' | '30d' | '90d' | 'all'

export interface ActivityTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  costUsd: number
  turns: number
}

export interface ActivityByModel {
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  costUsd: number
  turns: number
}

export interface ActivityByAccount {
  accountId: string
  label: string
  provider: string
  totalTokens: number
  costUsd: number
  turns: number
}

export interface ActivityByDay {
  // Local-day YYYY-MM-DD.
  date: string
  totalTokens: number
  costUsd: number
}

// One local day of a single session's spend INSIDE the Activity window. Unlike
// SessionCostDay (below) this is re-priced from the current catalog and honours
// the page's account/project filters, so an expanded row always sums to its
// parent row — the two must not be mixed in one view.
export interface ActivitySessionDay {
  date: string
  totalTokens: number
  costUsd: number
  turns: number
}

// Per-session usage rollup for the range (Sessions only — tasks are grouped
// separately). `model`/`provider` are the session's dominant model (most tokens).
export interface ActivityBySession {
  sessionId: string
  title: string
  // Owning project id (if the session is scoped to one). Display-only.
  projectId?: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  costUsd: number
  turns: number
  // ISO of the session's most recent counted turn in range.
  lastAt: string
  // Per-day split of the row above, oldest → newest, active days only (a day the
  // session did not run is absent, not a zero row).
  byDay: ActivitySessionDay[]
}

export interface ActivitySummary {
  range: ActivityRange
  // ISO range bounds [from, to] actually covered by the response.
  from: string
  to: string
  totals: ActivityTotals
  byModel: ActivityByModel[]
  byAccount: ActivityByAccount[]
  // Per-session usage (Sessions only), sorted by total tokens desc.
  bySession: ActivityBySession[]
  // Oldest → newest, one per local day in range.
  byDay: ActivityByDay[]
  // Model ids referenced in the period that have no effective price → their cost
  // is omitted from the totals + flagged so the UI can warn.
  missingPrices: string[]
}

// One local day of a single session's spend (sessions.cost-breakdown). `date` is
// the sidecar-local YYYY-MM-DD the turns completed on — a session spanning several
// days yields one entry per active day, which the UI sums into 1d/7d/30d/custom
// ranges. `costUsd` is the SUM of each turn's persisted `usage.costUsd` (the stable
// per-turn figure, single source of truth), so the total matches the session's
// cumulative cost shown elsewhere — it is not re-priced from the current catalog.
export interface SessionCostDay {
  date: string
  costUsd: number
  totalTokens: number
  turns: number
}

// Per-session cost timeline for the Cost tab. `byDay` is oldest → newest; `total`
// sums the whole session lifetime; `firstAt`/`lastAt` (ISO) bound the range picker.
// `hasUnpriced` is true when ≥1 counted turn had no persisted price (its cost is
// treated as 0), so the UI can flag an under-count.
export interface SessionCostBreakdown {
  sessionId: string
  byDay: SessionCostDay[]
  total: { costUsd: number; totalTokens: number; turns: number }
  firstAt?: string
  lastAt?: string
  hasUnpriced: boolean
}

// Which pricing layer supplied the effective rates of a model row.
// Priority (highest wins): override > remote > default.
export type ModelPriceSource = 'default' | 'remote' | 'override'

// One row of `activity.pricing` — the effective USD/1M-token rates for a model.
export interface ModelPrice {
  model: string
  provider: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  // True when a user override (Settings `modelPricing`) is in effect for any
  // bucket of this model.
  isOverride: boolean
  // Highest-priority layer that contributed to the effective rates.
  source: ModelPriceSource
}

export interface ActivityPricing {
  models: ModelPrice[]
  // ISO timestamp of the last successful `activity.pricing.fetch` (when the
  // remote layer file exists). Absent if the catalog was never refreshed.
  fetchedAt?: string
}

// Return of `activity.pricing.fetch` — refresh the remote pricing layer.
export interface ActivityPricingFetch {
  fetchedAt: string
  source: string
  // Number of AWOG models matched from the remote source.
  updated: number
  // Effective catalog after merge (same shape/order as `activity.pricing`).
  models: ModelPrice[]
}

// ─── Wiki ──────────────────────────────────────────────────────────────────
// In-app documentation, doubling as the LLM's context source (ADR 0073).
// Two tiers, AWOG-owned (the Claude Code CLI has no `wiki` kind, so this does
// NOT belong in the shared `.claude` home of ADR 0070):
//
//   global  → ~/.awog/wiki/<space>/**/*.md              (applies everywhere)
//   project → {project.path}/.awog/wiki/<space>/**/*.md  (that project only)
//
// `path` is the slug: the root-relative path WITHOUT the `.md` extension, always
// forward-slashed (`architecture/system-overview`). It is the id used by
// `[[wikilinks]]`, by the `wiki_read` tool, and by the UI tree.

export type WikiSource = 'global' | 'project'

export interface WikiPage {
  path: string
  source: WikiSource
  projectId?: string
  // First segment of `path`, or '' for a page sitting at the wiki root.
  space: string
  title: string
  description: string
  tags: string[]
  // False = hidden from the LLM (index + search). A private note stays readable
  // in the app but never reaches a prompt.
  context: boolean
  bytes: number
  updatedAt: number
}

export interface WikiSpace {
  id: string
  source: WikiSource
  projectId?: string
  title: string
  description: string
  pageCount: number
}

export interface WikiTree {
  spaces: WikiSpace[]
  pages: WikiPage[]
  // One entry per scanned root so the UI can report where it looked (mirrors
  // RuleScanReport) — a wiki that yields nothing is usually a missing dir.
  reports: { dir: string; source: WikiSource; projectId?: string; found: number }[]
}

// A page plus its content. `raw` is the file verbatim (frontmatter included) for
// the editor; `body` is the content below the frontmatter for the reader.
export interface WikiPageContent {
  page: WikiPage
  raw: string
  body: string
  truncated: boolean
}

export interface WikiSearchHit {
  path: string
  source: WikiSource
  projectId?: string
  title: string
  line: number
  preview: string
}

// Result of `wiki.import` — per-file outcome so the UI can say "18/21 imported"
// and name what it skipped instead of silently dropping files.
export interface WikiImportReport {
  imported: string[]
  skipped: { name: string; reason: string }[]
}

// ─── AI memory ─────────────────────────────────────────────────────────────
// Long-term facts the agent accumulates and the user curates (ADR 0073 part B).
// One fact per file, two tiers under `.awog`:
//
//   global  → ~/.awog/memory/<slug>.md
//   project → {project.path}/.awog/memory/<slug>.md
//
// `description` is the fact in ONE LINE and is what the prompt receives; `body` is
// optional detail the model pulls with `memory_read`. There is no MEMORY.md index
// on disk — the injected index is derived from these frontmatters (D-10).

export type MemorySource = 'global' | 'project'
export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'

export interface MemoryFact {
  // Slug = filename without the extension.
  id: string
  source: MemorySource
  projectId?: string
  name: string
  description: string
  body: string
  type: MemoryType
  enabled: boolean
  // mtime — drives "most recent first" inside a type group.
  updatedAt: number
}

// Per-turn context switches the renderer owns (ADR 0073 D-12). Settings live in
// the UI blob (ADR 0045: the sidecar treats settings.json as opaque), so the flags
// travel WITH the turn — the same path `responseStyle` / `sshApprovalMode` take.
// Every field is optional: an absent field means the documented default, so an
// older UI build keeps working.
export interface ContextConfig {
  // Inject the wiki table of contents. Default true.
  wikiEnabled?: boolean | undefined
  wikiBudgetChars?: number | undefined
  // Inject the memory index. Default true.
  memoryEnabled?: boolean | undefined
  // Let the agent WRITE memory (memory_remember / memory_forget). Default FALSE —
  // a model that quietly accumulates claims about the user is opt-in only.
  memoryAutoWrite?: boolean | undefined
  memoryBudgetChars?: number | undefined
}
