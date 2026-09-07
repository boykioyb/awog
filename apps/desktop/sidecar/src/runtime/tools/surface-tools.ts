// Model-initiated transcript surfaces — the five tools with which the model hands
// something to the USER instead of doing work (docs/features/session-model-surfaces.md):
//
//   mark_chapter       phase boundary → divider + jump menu in the transcript
//   send_user_file     workspace files → openable cards (shared PreviewModal)
//   suggest_task       out-of-scope work → one-click new session, dismissible
//   suggest_followups  2–3 clickable next prompts under the last reply
//   report_findings    review findings → severity-sorted list, each row opens its file
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
// chapter per tool call turns navigation into noise, and one that reports every
// suspicion as a finding turns review into a triage queue. Three layers, cheapest
// first:
//   1. the tool DESCRIPTION states the budget (3–8 chapters, one suggestion per
//      reply, a handful of VERIFIED findings) in policy terms (ADR 0071);
//   2. a PER-TURN counter — the toolset is rebuilt every turn, so one counter
//      object per turn is exactly "once per reply" — plus, for findings, a cap on
//      how many rows one call may carry;
//   3. a PER-SESSION ledger (module-level, keyed by session id like read-registry)
//      that caps the total and refuses a repeat of a title/finding already shown.
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
// Findings: the tightest budget of the five, because this is the surface that
// rots fastest. A review that reports 8 verified defects is a review; a table of
// 40 "this might be a problem" rows costs the user more to triage than reading
// the diff themselves, so the caps are set where triage is still cheap.
const MAX_FINDINGS_PER_CALL = 8
const MAX_FINDINGS_PER_SESSION = 20

// Field clamps. The model writes these; the transcript renders them as plain text
// (never HTML), and the prompt for a spawned session is capped so one suggestion
// can't carry an essay.
const TITLE_MAX = 80
const SUMMARY_MAX = 240
const TLDR_MAX = 200
const PROMPT_MAX = 4_000
const FOLLOWUP_MAX = 120
const SCOPE_MAX = 80
// A finding is read in a list, so both of its texts are one-liners in practice.
// `failure` gets more room than `summary` because it must name the concrete case
// (input/state → observed behaviour), which is the whole value of the row.
const FINDING_SUMMARY_MAX = 160
const FINDING_FAILURE_MAX = 400
const FINDING_VERDICT_MAX = 200
const FINDING_PATH_MAX = 300

// The tool names, and the in-process MCP server the Claude SDK path bridges them
// through. Single source of truth: step-mapper recognises both the bare name (Pi)
// and `mcp__awogsurfaces__<name>` (Claude SDK) from these. `report_findings` is
// listed here even though the SDK server does not expose it yet (that file is
// owned by a parallel workstream) — the bridged spelling simply never arrives.
export const SURFACE_MCP_SERVER = 'awogsurfaces'
export const SURFACE_TOOL_NAMES = [
  'mark_chapter',
  'send_user_file',
  'suggest_task',
  'suggest_followups',
  'report_findings',
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
  reportFindings: {
    description:
      'Report the defects a REVIEW found as a structured list instead of describing them in prose: ' +
      'each row carries file + line + severity, sorts worst-first, and opens the file when clicked, ' +
      'so the user never has to go hunting for a location you already know. ' +
      'Report only what you VERIFIED — you read the code and can name the input or state that breaks ' +
      'it. A suspicion you did not chase, a style preference, a "consider extracting this" are not ' +
      'findings; leave them in your prose or use suggest_task. A typical review has a handful of rows ' +
      `(max ${MAX_FINDINGS_PER_CALL} per call, ${MAX_FINDINGS_PER_SESSION} per session): a long table of ` +
      '"might be a problem" costs the user more to triage than reading the diff themselves, and is ' +
      'worse than no table at all. Call it ONCE, after you finish reviewing — not per file. ' +
      'A clean review calls nothing and says so in prose.',
    findings:
      `The verified defects, worst first. Max ${MAX_FINDINGS_PER_CALL} per call — if you have more, ` +
      'report only the ones that matter most and say so in your reply.',
    file: 'Path of the file the defect is IN, inside the workspace (absolute or workspace-relative).',
    line: 'The 1-based line where the defect is. Omit only for a defect with no single line (e.g. a missing file).',
    severity:
      'blocker = wrong behaviour, data loss, or a security hole users will hit; ' +
      'major = a real bug on a narrower path, or a contract the code breaks; ' +
      'minor = a genuine defect with low impact. If it is a preference, it is not a finding at all.',
    summary: 'One line naming the defect, e.g. "Cancel leaves the lock held".',
    failure:
      'The CONCRETE broken case: the input or state that triggers it and what actually happens then. ' +
      'Not "this could be unsafe" — "when `paths` is empty the loop writes an empty commit".',
    verdict:
      'How you CHECKED this one — the test you ran, the call path you traced, the line you read that ' +
      'proves it. Omit it if you did not verify it; do not write "verified" without saying how.',
    scope: 'Optional one line naming what you reviewed, e.g. "PR #128" or "the auth module".',
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
  // Identity of every finding already reported, `file:line:summary` normalised.
  // Re-reporting the same defect in a later turn is the noisiest failure mode of
  // this surface, so the ledger drops the repeat rather than the whole call.
  findings: string[]
}
const MAX_LEDGERS = 64
const ledgers = new Map<string, SurfaceLedger>()

function getLedger(sessionId: string): SurfaceLedger {
  const existing = ledgers.get(sessionId)
  if (existing) return existing
  const created: SurfaceLedger = { chapters: [], suggestions: [], findings: [] }
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
  findings: number
}

export function createSurfaceTurnCounters(): SurfaceTurnCounters {
  return { chapters: 0, suggestions: 0, followups: 0, findings: 0 }
}

// ── Findings payload ───────────────────────────────────────────────────────────
//
// Declared HERE, not in types/shared.ts next to `SessionSurface`, on purpose: that
// file is being edited by a parallel workstream and this package must not touch
// it. `SurfacePayload` is therefore the widened union everything in this package
// speaks, and `step-mapper.ts` holds the ONE bridging cast down to
// `SessionStep.surface`. Fold `SessionFindingsSurface` into the `SessionSurface`
// union and delete both when shared.ts is free again — see
// docs/features/session-model-surfaces.md §6.
export type FindingSeverity = 'blocker' | 'major' | 'minor'

export interface SessionFinding {
  // Workspace-RELATIVE path when the model named a real workspace file, otherwise
  // the raw string it wrote (clamped). Never an absolute path we resolved: the UI
  // resolves it against the session cwd exactly like a shared-file card.
  file: string
  // 1-based. Absent for a defect with no single line.
  line?: number
  severity: FindingSeverity
  summary: string
  failure: string
  // Present only when the model said HOW it checked this one.
  verdict?: string
  // false ⇒ the path is not a readable workspace file (outside the root, missing,
  // a directory). The row still renders — the TEXT is the finding — but it is not
  // a link, because a link that opens nothing is worse than plain text.
  linkable: boolean
}

export interface SessionFindingsSurface {
  kind: 'findings'
  findings: SessionFinding[]
  scope?: string
}

// Every surface payload this package can produce.
export type SurfacePayload = SessionSurface | SessionFindingsSurface

// What a surface call did: the text the model reads, plus the surface the user now
// sees (absent = refused, and the row renders as an error rather than as a card).
export interface SurfaceRunResult {
  text: string
  surface?: SurfacePayload
}

function refused(text: string): SurfaceRunResult {
  return { text }
}
function shown(text: string, surface: SurfacePayload): SurfaceRunResult {
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
const resolvedSurfaces = new Map<string, SurfacePayload>()

// The declared parameters of each tool, in a fixed order. Only these take part in
// the key, so an extra field the model invented (dropped by one schema layer, kept
// by the other) cannot desynchronise the two sides.
const SURFACE_KEY_FIELDS: Record<string, readonly string[]> = {
  mark_chapter: ['title', 'summary'],
  send_user_file: ['files', 'caption'],
  suggest_task: ['title', 'tldr', 'prompt'],
  suggest_followups: ['options'],
  report_findings: ['findings', 'scope'],
}

function keyPart(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    // `report_findings` passes an array of OBJECTS, so a string-only join would
    // collapse every one of its calls onto the same key. Serialise the non-string
    // entries instead; an entry that cannot be serialised contributes nothing,
    // which is a miss — and a miss is not a failure (see above).
    return value
      .map((entry) => {
        if (typeof entry === 'string') return entry
        try {
          return JSON.stringify(entry) ?? ''
        } catch {
          return ''
        }
      })
      .join('')
  }
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
  surface: SurfacePayload,
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
): SurfacePayload | undefined {
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

// ── report_findings ────────────────────────────────────────────────────────────

export interface ReportFindingsArgs {
  findings?: unknown
  scope?: unknown
}

// Severity is a closed set. An unrecognised value is NOT coerced to a default:
// silently filing a "critical" as a minor would misreport the review, so the row
// is dropped and the model is told which value it should have used.
const SEVERITIES: readonly FindingSeverity[] = ['blocker', 'major', 'minor']

function asSeverity(value: unknown): FindingSeverity | null {
  const raw = asText(value).trim().toLowerCase()
  // `find` rather than `includes`: it NARROWS, so no cast is needed to hand the
  // value back as a FindingSeverity.
  return SEVERITIES.find((s) => s === raw) ?? null
}

// 1-based line, or undefined. A float / 0 / negative is not a line number; the
// model wrote something else and the row degrades to file-level rather than
// pointing at a line that does not exist.
function asLine(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return undefined
  return value
}

// Identity of a finding for the per-session ledger: same file, same line, same
// summary ⇒ the same defect, however the prose around it was reworded.
function findingKey(f: SessionFinding): string {
  return `${f.file}\u0001${f.line ?? 0}\u0001${normaliseTitle(f.summary)}`
}

// The path the row points at. Same rule as a shared-file card (invariant #2:
// resolve, stay inside the root, then confirm it is a real file) with one
// deliberate difference: a path that fails does NOT drop the finding. The finding
// is TEXT the user needs to read; only the LINK is withheld, because a link that
// opens nothing is worse than plain text.
async function resolveFindingPath(
  cwd: string,
  given: string,
): Promise<{ file: string; linkable: boolean }> {
  const raw = given.trim().slice(0, FINDING_PATH_MAX)
  if (!raw) return { file: '', linkable: false }
  let abs: string
  try {
    abs = assertInsideWorkspace(cwd, raw)
  } catch {
    return { file: raw, linkable: false }
  }
  try {
    const st = await stat(abs)
    if (!st.isFile()) return { file: raw, linkable: false }
  } catch {
    return { file: raw, linkable: false }
  }
  const rel = relative(cwd, abs)
  return { file: rel && !rel.startsWith('..') ? rel : basename(abs), linkable: true }
}

// One row, validated. Returns null when the row carries no finding: no location,
// no defect named, or no failure case — the three things that separate a finding
// from an opinion.
async function toFinding(cwd: string, raw: unknown): Promise<SessionFinding | null> {
  const rec = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const summary = clamp(asText(rec.summary), FINDING_SUMMARY_MAX)
  const failure = clamp(asText(rec.failure), FINDING_FAILURE_MAX)
  const severity = asSeverity(rec.severity)
  if (!summary || !failure || !severity) return null
  const { file, linkable } = await resolveFindingPath(cwd, asText(rec.file))
  if (!file) return null
  const line = asLine(rec.line)
  const verdict = clamp(asText(rec.verdict), FINDING_VERDICT_MAX)
  return {
    file,
    ...(line !== undefined ? { line } : {}),
    severity,
    summary,
    failure,
    ...(verdict ? { verdict } : {}),
    linkable,
  }
}

export async function runReportFindings(
  args: ReportFindingsArgs,
  cwd: string,
  sessionId: string,
  turn: SurfaceTurnCounters,
): Promise<SurfaceRunResult> {
  const rows = Array.isArray(args.findings) ? args.findings : []
  if (rows.length === 0) return refused('Rejected: no findings were given.')
  // Guard layer 2a — one findings list per reply. A review that reports per file
  // produces N lists the user has to read as one; make it triage before it calls.
  if (turn.findings >= 1) {
    return refused(
      'Rejected: you already reported findings in this reply. Report a review ONCE, as a single ' +
        'list — if you found something after the fact, put it in your prose.',
    )
  }
  // Guard layer 2b — the per-call cap. Refused rather than truncated on purpose:
  // silently dropping rows would let the model believe it reported all of them,
  // and the triage decision (which ones matter) belongs to the reviewer.
  if (rows.length > MAX_FINDINGS_PER_CALL) {
    return refused(
      `Rejected: ${rows.length} findings in one call is past the point where a list helps. Report ` +
        `at most ${MAX_FINDINGS_PER_CALL} — the ones you verified and would block on — and cover ` +
        'the rest in your reply.',
    )
  }
  const parsed: SessionFinding[] = []
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop -- at most MAX_FINDINGS_PER_CALL stats, and each
    // one gates whether the NEXT row is a duplicate; the parallel version buys nothing here.
    const finding = await toFinding(cwd, row)
    if (finding) parsed.push(finding)
  }
  if (parsed.length === 0) {
    return refused(
      'Rejected: no usable finding. Each one needs a file, a `severity` of blocker/major/minor, a ' +
        '`summary` naming the defect and a `failure` describing the case that breaks.',
    )
  }
  // Guard layer 3 — the per-session ledger: drop a defect already reported (a
  // reworded repeat reads as a new problem), then trim to what is left of the
  // session budget.
  const ledger = getLedger(sessionId)
  const seen = new Set(ledger.findings)
  const fresh: SessionFinding[] = []
  let repeats = 0
  for (const finding of parsed) {
    const key = findingKey(finding)
    if (seen.has(key)) {
      repeats += 1
      continue
    }
    seen.add(key)
    fresh.push(finding)
  }
  const budget = MAX_FINDINGS_PER_SESSION - ledger.findings.length
  if (budget <= 0) {
    return refused(
      `Rejected: this session already reported ${MAX_FINDINGS_PER_SESSION} findings, which is more ` +
        'than anyone will act on. Stop listing and summarise what matters in your reply.',
    )
  }
  if (fresh.length === 0) {
    return refused(
      `Rejected: all ${repeats} of these were already reported in this session. The user still sees ` +
        'the earlier list — do not repeat it.',
    )
  }
  const shownFindings = fresh.slice(0, budget)
  const dropped = fresh.length - shownFindings.length
  turn.findings += 1
  for (const finding of shownFindings) ledger.findings.push(findingKey(finding))
  const scope = clamp(asText(args.scope), SCOPE_MAX)
  const notLinkable = shownFindings.filter((f) => !f.linkable).map((f) => f.file)
  const notes = [
    repeats > 0 ? ` ${repeats} duplicate(s) of earlier findings were dropped.` : '',
    dropped > 0 ? ` ${dropped} did not fit the per-session budget and were dropped.` : '',
    notLinkable.length > 0
      ? ` Not openable (not a workspace file, shown as plain text): ${notLinkable.join(', ')}.`
      : '',
  ].join('')
  return shown(
    `Shown to the user as ${shownFindings.length} finding(s), worst first, each opening its file.` +
      `${notes} Do not repeat the list in your text — summarise the verdict instead.`,
    { kind: 'findings', findings: shownFindings, ...(scope ? { scope } : {}) },
  )
}

// ── Pi AgentTools ──────────────────────────────────────────────────────────────
// Thin wrappers: schema + the shared runner. The Claude SDK path wraps the same
// runners in runtime/claude-sdk/surface-sdk-server.ts.

// Every tool here reports the same two things: what the user now sees (`surface`,
// read by step-mapper) and whether the call actually did anything.
export interface SurfaceToolDetails {
  surface?: SurfacePayload
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

const FindingsParams = Type.Object({
  findings: Type.Array(
    Type.Object({
      file: Type.String({ description: SURFACE_TOOL_TEXT.reportFindings.file }),
      line: Type.Optional(Type.Number({ description: SURFACE_TOOL_TEXT.reportFindings.line })),
      severity: Type.Union(
        [Type.Literal('blocker'), Type.Literal('major'), Type.Literal('minor')],
        {
          description: SURFACE_TOOL_TEXT.reportFindings.severity,
        },
      ),
      summary: Type.String({ description: SURFACE_TOOL_TEXT.reportFindings.summary }),
      failure: Type.String({ description: SURFACE_TOOL_TEXT.reportFindings.failure }),
      verdict: Type.Optional(
        Type.String({ description: SURFACE_TOOL_TEXT.reportFindings.verdict }),
      ),
    }),
    { description: SURFACE_TOOL_TEXT.reportFindings.findings },
  ),
  scope: Type.Optional(Type.String({ description: SURFACE_TOOL_TEXT.reportFindings.scope })),
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

function createReportFindingsTool(
  cwd: string,
  sessionId: string,
  turn: SurfaceTurnCounters,
): AgentTool<typeof FindingsParams> {
  return {
    name: 'report_findings',
    label: 'Findings',
    description: SURFACE_TOOL_TEXT.reportFindings.description,
    parameters: FindingsParams,
    async execute(_id, params): Promise<AgentToolResult<SurfaceToolDetails>> {
      return toAgentResult(await runReportFindings(params, cwd, sessionId, turn))
    },
  }
}

export interface CreateSurfaceToolsOptions {
  // Session the turn belongs to — the key of the per-session abuse ledger.
  sessionId: string
}

// The five tools, for a chat turn. `cwd` is the session's workspace root: the only
// directory send_user_file may hand out and the only one a finding may link into.
export function createSurfaceTools(cwd: string, opts: CreateSurfaceToolsOptions): AgentTool[] {
  // Built once per turn with the toolset ⇒ this IS the per-reply guard.
  const turn = createSurfaceTurnCounters()
  return [
    createMarkChapterTool(opts.sessionId, turn),
    createSendUserFileTool(cwd),
    createSuggestTaskTool(opts.sessionId, turn),
    createSuggestFollowupsTool(turn),
    createReportFindingsTool(cwd, opts.sessionId, turn),
  ] as AgentTool[]
}
