// Model-initiated transcript surfaces — the four tools with which the model hands
// something to the USER instead of doing work (docs/features/session-model-surfaces.md):
//
//   mark_chapter       phase boundary → divider + jump menu in the transcript
//   send_user_file     workspace files → openable cards (shared PreviewModal)
//   suggest_task       out-of-scope work → one-click new session, dismissible
//   suggest_followups  2–3 clickable next prompts under the last reply
//
// They share one seam: each call carries a `SessionSurface` payload that
// step-mapper turns into a `kind: 'surface'` step, so the surfaces persist in the
// JSONL transcript and re-hydrate on reload like any other step. No new IPC
// channel, no new store, no extra LLM round-trip.
//
// Chat sessions ONLY (gated on ToolFilter.chatSession in index.ts): a task run or
// a subagent has no user watching a transcript, so the schemas would be pure token
// cost there.
//
// Abuse control is the design problem here, not capability — a model that marks a
// chapter per tool call turns navigation into noise. Three layers, cheapest first:
//   1. the tool DESCRIPTION states the budget (3–8 chapters, one suggestion per
//      reply) in policy terms (ADR 0071);
//   2. a PER-TURN counter — the toolset is rebuilt every turn, so one counter
//      object per turn is exactly "once per reply";
//   3. a PER-SESSION ledger (module-level, keyed by session id like read-registry)
//      that caps the total and refuses a repeat of a title already marked.
// Layers 2+3 answer with a normal result flagged `isError` (tool-error.ts), so the
// model reads why it was refused and the row renders as a failure rather than as a
// chapter that never happened.
//
// TWO RUNTIMES, ONE IMPLEMENTATION. Everything below the schema line is shared:
// the Pi path wraps the `run*` functions as AgentTools here, the Claude SDK path
// wraps the SAME functions as an in-process MCP server
// (runtime/claude-sdk/surface-sdk-server.ts). Only the parameter SCHEMAS are
// declared twice, because the two runtimes speak different schema libraries
// (TypeBox vs zod) — the descriptions that carry the policy are constants shared
// by both, so the two branches cannot drift apart in what they tell the model.

import { basename, relative } from 'node:path'
import { stat } from 'node:fs/promises'
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { assertInsideWorkspace } from '../../git/path-sanitize.js'
import type { SessionSharedFile, SessionSurface } from '../../types/shared.js'

// Budgets. Deliberately small: every one of these surfaces competes with the
// user's attention, and an unbounded list is the same as no list.
const MAX_CHAPTERS_PER_SESSION = 10
const MAX_SUGGESTIONS_PER_SESSION = 6
const MAX_FILES_PER_CALL = 10
const MAX_FOLLOWUPS = 3

// Field clamps. The model writes these; the transcript renders them as plain text
// (never HTML), and the prompt for a spawned session is capped so one suggestion
// can't carry an essay.
const TITLE_MAX = 80
const SUMMARY_MAX = 240
const TLDR_MAX = 200
const PROMPT_MAX = 4_000
const FOLLOWUP_MAX = 120

// The four tool names, and the in-process MCP server the Claude SDK path bridges
// them through. Single source of truth: step-mapper recognises both the bare name
// (Pi) and `mcp__awogsurfaces__<name>` (Claude SDK) from these.
export const SURFACE_MCP_SERVER = 'awogsurfaces'
export const SURFACE_TOOL_NAMES = [
  'mark_chapter',
  'send_user_file',
  'suggest_task',
  'suggest_followups',
] as const

// Every string the model reads about these tools. Shared by the TypeBox schemas
// below and the zod schemas on the Claude SDK path — guard layer 1 lives here, so
// it is the same policy on both runtimes by construction.
export const SURFACE_TOOL_TEXT = {
  markChapter: {
    description:
      'Mark the point where this session moves into a NEW PHASE of work — exploring → implementing → ' +
      'verifying, or a switch to a different problem. The transcript draws a divider there and adds the ' +
      'chapter to a jump menu, so the user can navigate a long session. ' +
      'Budget: a typical session has 3–8 chapters. Mark a phase change, never an individual step or tool ' +
      'call, never the first message of a session, and at most once per reply. If you are not sure the ' +
      'phase really changed, do not call this — an unmarked session reads better than a mislabelled one.',
    title:
      'Short name for the phase that starts here, 2–6 words, e.g. "Reproducing the bug" or "Wiring the UI".',
    summary:
      'Optional one line on what this phase covers. Shown under the divider; omit it when the title already says everything.',
  },
  sendUserFile: {
    description:
      'Hand the user files that already exist in the workspace: they appear as clickable cards in the ' +
      'conversation and open in the file viewer. Use it when you produced or found something the user ' +
      'will want to OPEN — a generated report, a diagram, a screenshot, a diff you wrote to disk — ' +
      'instead of pasting the content into your reply or only naming the file in prose. ' +
      'Paths must be inside the workspace and must exist; anything else is refused. Do not send back ' +
      'files the user just gave you, do not send a file you only plan to write, and once a card is ' +
      'shown do not repeat the file content in your text.',
    files:
      'Paths of EXISTING files inside the workspace (absolute or workspace-relative). Max 10 per call.',
    caption: 'Optional one line telling the user what these files are.',
  },
  suggestTask: {
    description:
      'Park work you noticed that is OUT OF SCOPE for what you were asked to do — dead code, a stale ' +
      'doc, a missing test, a refactor worth doing later — as a one-click suggestion the user can ' +
      'start in its own session, instead of doing it now (scope creep) or padding your reply with it. ' +
      'If it IS part of the task you were given, just do it. Budget: at most one per reply, a handful ' +
      'per session; the user can dismiss a chip, so do not re-suggest something you already suggested.',
    title: 'Short name for the work, e.g. "Delete the unused exporter".',
    tldr: "One line on why it is worth doing, in the user's terms — what is wrong today and what improves.",
    prompt:
      'The SELF-CONTAINED instruction sent to the new session. It starts with no memory of this ' +
      'conversation: name the files/paths, state the goal and the constraints in full.',
  },
  suggestFollowups: {
    description:
      'Offer 2–3 short next prompts the user can click instead of typing, shown under your answer. ' +
      'Call it AT MOST ONCE, as the LAST tool call of your reply, and only when the next steps are ' +
      'concrete and specific to what you just said. Skip it when your answer stands on its own or when ' +
      'the options would be generic filler ("Tell me more") — no follow-up bar is better than three ' +
      'useless chips. The user sees them only until they start typing.',
    options:
      'Two or three short next prompts, written as the USER would type them ("Run the tests", ' +
      '"Show me the diff for auth.ts"). Max 3.',
  },
} as const

function clamp(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

// The model's arguments are L1 (untrusted): read every field as `unknown` and
// narrow here, so both runtimes get the same coercion regardless of what their
// schema layer let through.
function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// Case/whitespace-insensitive identity, used to refuse "Implementation" twice.
function normaliseTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

// ── Per-session ledger ─────────────────────────────────────────────────────────
// In memory only, keyed by session id, same shape + eviction policy as
// read-registry.ts. It is an ABUSE GUARD, not a source of truth: a sidecar restart
// resets it, which at worst lets a resumed session mark a few extra chapters. The
// authoritative record of what was marked is the persisted transcript.
interface SurfaceLedger {
  chapters: string[]
  suggestions: string[]
}
const MAX_LEDGERS = 64
const ledgers = new Map<string, SurfaceLedger>()

function getLedger(sessionId: string): SurfaceLedger {
  const existing = ledgers.get(sessionId)
  if (existing) return existing
  const created: SurfaceLedger = { chapters: [], suggestions: [] }
  ledgers.set(sessionId, created)
  if (ledgers.size > MAX_LEDGERS) {
    const oldest = ledgers.keys().next()
    if (!oldest.done) ledgers.delete(oldest.value)
  }
  return created
}

// ── Per-turn counters ──────────────────────────────────────────────────────────
// Guard layer 2. Both runtimes rebuild their toolset once per turn (Pi:
// buildTools; Claude SDK: buildSurfaceToolsSdkServer inside runStream), so one of
// these objects per turn IS "per reply" on either path.
export interface SurfaceTurnCounters {
  chapters: number
  suggestions: number
  followups: number
}

export function createSurfaceTurnCounters(): SurfaceTurnCounters {
  return { chapters: 0, suggestions: 0, followups: 0 }
}

// What a surface call did: the text the model reads, plus the surface the user now
// sees (absent = refused, and the row renders as an error rather than as a card).
export interface SurfaceRunResult {
  text: string
  surface?: SessionSurface
}

function refused(text: string): SurfaceRunResult {
  return { text }
}
function shown(text: string, surface: SessionSurface): SurfaceRunResult {
  return { text, surface }
}

// ── Resolved-surface handoff (Claude SDK path) ─────────────────────────────────
//
// A tool result reaches step-mapper with a `details` side channel on the Pi path
// only: the Claude SDK bridges an MCP result down to text + isError, so the
// VALIDATED payload (above all the file list that survived path validation) has
// nowhere to ride. The SDK server parks it here and step-mapper claims it,
// correlated by the CALL ARGUMENTS — the one thing both sides see (the MCP handler
// never learns the `tool_use` id).
//
// Consequences, stated rather than hidden:
//   - two calls with IDENTICAL arguments collapse to one entry. Harmless: the same
//     arguments produce the same surface;
//   - the key is not session-scoped (step-mapper has no session id at that point),
//     so two sessions sending the same relative path concurrently could swap
//     entries. The card's path/name are derived from the path string either way;
//     only the displayed byte size could be the other session's;
//   - entries are NOT consumed on read (a second mapping of the same result must
//     not degrade to an empty card) — the map is bounded and evicts oldest-first;
//   - a miss is not a failure: step-mapper falls back to the call arguments.
const MAX_RESOLVED_SURFACES = 32
const resolvedSurfaces = new Map<string, SessionSurface>()

// The declared parameters of each tool, in a fixed order. Only these take part in
// the key, so an extra field the model invented (dropped by one schema layer, kept
// by the other) cannot desynchronise the two sides.
const SURFACE_KEY_FIELDS: Record<string, readonly string[]> = {
  mark_chapter: ['title', 'summary'],
  send_user_file: ['files', 'caption'],
  suggest_task: ['title', 'tldr', 'prompt'],
  suggest_followups: ['options'],
}

function keyPart(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((entry) => asText(entry)).join('')
  return ''
}

function surfaceCallKey(toolName: string, args: Record<string, unknown>): string | undefined {
  const fields = SURFACE_KEY_FIELDS[toolName]
  if (!fields) return undefined
  return [toolName, ...fields.map((f) => keyPart(args[f]))].join('')
}

export function rememberResolvedSurface(
  toolName: string,
  args: Record<string, unknown>,
  surface: SessionSurface,
): void {
  const key = surfaceCallKey(toolName, args)
  if (!key) return
  resolvedSurfaces.set(key, surface)
  if (resolvedSurfaces.size > MAX_RESOLVED_SURFACES) {
    const oldest = resolvedSurfaces.keys().next()
    if (!oldest.done) resolvedSurfaces.delete(oldest.value)
  }
}

export function takeResolvedSurface(
  toolName: string,
  args: Record<string, unknown>,
): SessionSurface | undefined {
  const key = surfaceCallKey(toolName, args)
  return key ? resolvedSurfaces.get(key) : undefined
}

// ── mark_chapter ───────────────────────────────────────────────────────────────

export interface MarkChapterArgs {
  title?: unknown
  summary?: unknown
}

export function runMarkChapter(
  args: MarkChapterArgs,
  sessionId: string,
  turn: SurfaceTurnCounters,
): SurfaceRunResult {
  const title = clamp(asText(args.title), TITLE_MAX)
  if (!title) return refused('Rejected: a chapter needs a title.')
  if (turn.chapters >= 1) {
    return refused(
      'Rejected: you already marked a chapter in this reply. A chapter is a phase of the ' +
        'session, not a step — continue working and mark the next one when the phase actually changes.',
    )
  }
  const ledger = getLedger(sessionId)
  if (ledger.chapters.includes(normaliseTitle(title))) {
    return refused(
      `Rejected: "${title}" is already a chapter in this session. Reuse of a chapter title means the ` +
        'phase did not change; pick a different phase name or skip the marker.',
    )
  }
  if (ledger.chapters.length >= MAX_CHAPTERS_PER_SESSION) {
    return refused(
      `Rejected: this session already has ${MAX_CHAPTERS_PER_SESSION} chapters, which is past the ` +
        'point where a table of contents helps. Do not mark any more.',
    )
  }
  turn.chapters += 1
  ledger.chapters.push(normaliseTitle(title))
  const summary = clamp(asText(args.summary), SUMMARY_MAX)
  return shown(
    `Chapter "${title}" marked in the transcript (${ledger.chapters.length} so far). Do not repeat it in your reply.`,
    { kind: 'chapter', title, ...(summary ? { summary } : {}) },
  )
}

// ── send_user_file ─────────────────────────────────────────────────────────────

export interface SendUserFileArgs {
  files?: unknown
  caption?: unknown
}

// Validate the model's paths against the workspace (security invariant #2: resolve,
// keep inside the root, no `..`, no symlink escape) and confirm each one exists and
// is a regular file. A path that fails is REPORTED BACK to the model, never turned
// into a card: the card is a promise that clicking it opens something.
async function validateFiles(
  cwd: string,
  paths: unknown[],
): Promise<{ files: SessionSharedFile[]; rejected: string[] }> {
  const files: SessionSharedFile[] = []
  const rejected: string[] = []
  const seen = new Set<string>()
  for (const raw of paths.slice(0, MAX_FILES_PER_CALL)) {
    const given = asText(raw).trim()
    if (!given || seen.has(given)) continue
    seen.add(given)
    let abs: string
    try {
      abs = assertInsideWorkspace(cwd, given)
    } catch {
      rejected.push(`${given} (outside the workspace)`)
      continue
    }
    try {
      const st = await stat(abs)
      if (!st.isFile()) {
        rejected.push(`${given} (not a file)`)
        continue
      }
      const rel = relative(cwd, abs)
      files.push({
        path: rel && !rel.startsWith('..') ? rel : basename(abs),
        name: basename(abs),
        size: st.size,
      })
    } catch {
      rejected.push(`${given} (does not exist)`)
    }
  }
  return { files, rejected }
}

export async function runSendUserFile(
  args: SendUserFileArgs,
  cwd: string,
): Promise<SurfaceRunResult> {
  const requested = Array.isArray(args.files) ? args.files : []
  if (requested.length === 0) return refused('Rejected: no file paths were given.')
  const { files, rejected } = await validateFiles(cwd, requested)
  const overflow =
    requested.length > MAX_FILES_PER_CALL
      ? ` Only the first ${MAX_FILES_PER_CALL} paths were considered.`
      : ''
  const problems = rejected.length > 0 ? ` Not shown: ${rejected.join(', ')}.` : ''
  if (files.length === 0) {
    return refused(
      `No file card was shown — none of the paths could be used.${problems}${overflow} ` +
        'Check the path against the workspace root and that the file exists.',
    )
  }
  const caption = clamp(asText(args.caption), SUMMARY_MAX)
  return shown(
    `Shown to the user as openable file cards: ${files.map((f) => f.path).join(', ')}.` +
      `${problems}${overflow} Do not paste their contents into your reply.`,
    { kind: 'files', files, ...(caption ? { caption } : {}) },
  )
}

// ── suggest_task ───────────────────────────────────────────────────────────────

export interface SuggestTaskArgs {
  title?: unknown
  tldr?: unknown
  prompt?: unknown
}

export function runSuggestTask(
  args: SuggestTaskArgs,
  sessionId: string,
  turn: SurfaceTurnCounters,
): SurfaceRunResult {
  const title = clamp(asText(args.title), TITLE_MAX)
  const tldr = clamp(asText(args.tldr), TLDR_MAX)
  // The prompt keeps its line structure (it is an instruction, not a label) —
  // trim + cap only.
  const prompt = asText(args.prompt).trim().slice(0, PROMPT_MAX)
  if (!title || !prompt) {
    return refused('Rejected: a suggestion needs both a title and a self-contained prompt.')
  }
  if (turn.suggestions >= 1) {
    return refused(
      'Rejected: you already suggested a task in this reply. One out-of-scope item per reply — ' +
        'keep the rest for later or mention them in prose.',
    )
  }
  const ledger = getLedger(sessionId)
  if (ledger.suggestions.includes(normaliseTitle(title))) {
    return refused(`Rejected: "${title}" was already suggested in this session.`)
  }
  if (ledger.suggestions.length >= MAX_SUGGESTIONS_PER_SESSION) {
    return refused(
      `Rejected: ${MAX_SUGGESTIONS_PER_SESSION} suggestions is already more than the user will act ` +
        'on. Stop suggesting and finish the task at hand.',
    )
  }
  turn.suggestions += 1
  ledger.suggestions.push(normaliseTitle(title))
  return shown(
    `Suggested "${title}" as a separate task. The user decides — do not start on it and do not bring it up again.`,
    { kind: 'suggestion', title, prompt, tldr },
  )
}

// ── suggest_followups ──────────────────────────────────────────────────────────

export interface SuggestFollowupsArgs {
  options?: unknown
}

export function runSuggestFollowups(
  args: SuggestFollowupsArgs,
  turn: SurfaceTurnCounters,
): SurfaceRunResult {
  if (turn.followups >= 1) {
    return refused('Rejected: follow-up suggestions were already offered in this reply.')
  }
  const options = (Array.isArray(args.options) ? args.options : [])
    .map((o) => clamp(asText(o), FOLLOWUP_MAX))
    .filter((o) => o.length > 0)
    .slice(0, MAX_FOLLOWUPS)
  if (options.length === 0) return refused('Rejected: no follow-up text was given.')
  turn.followups += 1
  return shown(
    `Offered ${options.length} follow-up prompt(s) under your answer. Do not list them again in your text.`,
    { kind: 'followups', options },
  )
}

// ── Pi AgentTools ──────────────────────────────────────────────────────────────
// Thin wrappers: schema + the shared runner. The Claude SDK path wraps the same
// runners in runtime/claude-sdk/surface-sdk-server.ts.

// Every tool here reports the same two things: what the user now sees (`surface`,
// read by step-mapper) and whether the call actually did anything.
export interface SurfaceToolDetails {
  surface?: SessionSurface
  isError?: boolean
}

function toAgentResult(result: SurfaceRunResult): AgentToolResult<SurfaceToolDetails> {
  return {
    content: [{ type: 'text', text: result.text }],
    details: result.surface ? { surface: result.surface } : { isError: true },
  }
}

const ChapterParams = Type.Object({
  title: Type.String({ description: SURFACE_TOOL_TEXT.markChapter.title }),
  summary: Type.Optional(Type.String({ description: SURFACE_TOOL_TEXT.markChapter.summary })),
})

const FilesParams = Type.Object({
  files: Type.Array(Type.String(), { description: SURFACE_TOOL_TEXT.sendUserFile.files }),
  caption: Type.Optional(Type.String({ description: SURFACE_TOOL_TEXT.sendUserFile.caption })),
})

const SuggestParams = Type.Object({
  title: Type.String({ description: SURFACE_TOOL_TEXT.suggestTask.title }),
  tldr: Type.String({ description: SURFACE_TOOL_TEXT.suggestTask.tldr }),
  prompt: Type.String({ description: SURFACE_TOOL_TEXT.suggestTask.prompt }),
})

const FollowupParams = Type.Object({
  options: Type.Array(Type.String(), { description: SURFACE_TOOL_TEXT.suggestFollowups.options }),
})

function createMarkChapterTool(
  sessionId: string,
  turn: SurfaceTurnCounters,
): AgentTool<typeof ChapterParams> {
  return {
    name: 'mark_chapter',
    label: 'Chapter',
    description: SURFACE_TOOL_TEXT.markChapter.description,
    parameters: ChapterParams,
    async execute(_id, params): Promise<AgentToolResult<SurfaceToolDetails>> {
      return toAgentResult(runMarkChapter(params, sessionId, turn))
    },
  }
}

function createSendUserFileTool(cwd: string): AgentTool<typeof FilesParams> {
  return {
    name: 'send_user_file',
    label: 'Share files',
    description: SURFACE_TOOL_TEXT.sendUserFile.description,
    parameters: FilesParams,
    async execute(_id, params): Promise<AgentToolResult<SurfaceToolDetails>> {
      return toAgentResult(await runSendUserFile(params, cwd))
    },
  }
}

function createSuggestTaskTool(
  sessionId: string,
  turn: SurfaceTurnCounters,
): AgentTool<typeof SuggestParams> {
  return {
    name: 'suggest_task',
    label: 'Suggest task',
    description: SURFACE_TOOL_TEXT.suggestTask.description,
    parameters: SuggestParams,
    async execute(_id, params): Promise<AgentToolResult<SurfaceToolDetails>> {
      return toAgentResult(runSuggestTask(params, sessionId, turn))
    },
  }
}

function createSuggestFollowupsTool(turn: SurfaceTurnCounters): AgentTool<typeof FollowupParams> {
  return {
    name: 'suggest_followups',
    label: 'Follow-ups',
    description: SURFACE_TOOL_TEXT.suggestFollowups.description,
    parameters: FollowupParams,
    async execute(_id, params): Promise<AgentToolResult<SurfaceToolDetails>> {
      return toAgentResult(runSuggestFollowups(params, turn))
    },
  }
}

export interface CreateSurfaceToolsOptions {
  // Session the turn belongs to — the key of the per-session abuse ledger.
  sessionId: string
}

// The four tools, for a chat turn. `cwd` is the session's workspace root: the only
// directory send_user_file may hand out.
export function createSurfaceTools(cwd: string, opts: CreateSurfaceToolsOptions): AgentTool[] {
  // Built once per turn with the toolset ⇒ this IS the per-reply guard.
  const turn = createSurfaceTurnCounters()
  return [
    createMarkChapterTool(opts.sessionId, turn),
    createSendUserFileTool(cwd),
    createSuggestTaskTool(opts.sessionId, turn),
    createSuggestFollowupsTool(turn),
  ] as AgentTool[]
}
