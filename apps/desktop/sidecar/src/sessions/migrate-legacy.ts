// One-shot migration to the FOLDER-per-session single-file layout (craft-parity
// storage — ADR 0062 optional phase). Target on-disk shape:
//   ~/.awog/sessions/{id}/session.jsonl   line 1 = SessionHeader, lines 2+ = messages
//   ~/.awog/sessions/{id}/attachments/    externalized image/PDF attachment bytes
//
// This one migration covers BOTH earlier formats that may still exist as FLAT files
// directly under sessions/:
//   1. LEGACY event log        — first line has a string `type` (session.created …);
//                                 folded via the retained private reducer below.
//   2. INTERIM flat single-file — first line is a SessionHeader (top-level id +
//                                 numeric messageCount); parsed with readSessionJsonl.
// A DIRECTORY entry is already in the target layout → skipped.
//
// Runs once per boot (via sessionManager.ensureLoaded), idempotent + best-effort per
// file. Destructive (the flat file is folded then removed), so the original flat file
// is backed up to `{id}.jsonl.bak` FIRST (never clobbering an existing backup) and only
// unlinked AFTER the folder is written — a crash between backup and folder-write leaves
// the flat file + .bak, so it is simply re-migrated next boot.

import { createReadStream, type Dirent } from 'node:fs'
import { readdir, copyFile, unlink, access, rename, mkdir } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { log } from '../util/logger.js'
import type {
  Session,
  SessionCompaction,
  SessionMessage,
  SessionStep,
} from '../types/shared.js'
import {
  attachmentsDir,
  readSessionJsonl,
  sessionFilePath,
  sessionsDir,
  writeSessionJsonl,
} from './jsonl.js'

// ─── Legacy event log (verbatim reducer from the pre-cutover event-sourced store) ─

// Metadata patch carried by a legacy `session.metadata.updated` event. Kept as a
// standalone type so the reducer folds old logs faithfully.
type LegacySessionMetadataPatch = Partial<
  Pick<
    Session,
    | 'title'
    | 'pinned'
    | 'projectId'
    | 'settings'
    | 'invitedAgentIds'
    | 'disabledTools'
    | 'mcpServerIds'
    | 'aboutTaskId'
    | 'aboutSshHostId'
    | 'aboutGhUrl'
    | 'pinnedContext'
    | 'workspaceFolder'
    | 'budget'
    | 'parentSessionId'
    | 'forkFromMessageId'
    | 'sdkSessionId'
  >
>

type LegacySessionEvent =
  | { type: 'session.created'; at: string; session: Session }
  | { type: 'session.metadata.updated'; at: string; patch: LegacySessionMetadataPatch }
  | { type: 'message.appended'; at: string; message: SessionMessage }
  | { type: 'message.progress'; at: string; id: string; textDelta?: string; steps?: SessionStep[] }
  | { type: 'session.truncated'; at: string; keepThroughId: string | null }
  | { type: 'session.compacted'; at: string; compaction: SessionCompaction }
  | { type: 'session.deleted'; at: string }

type FoldState = { snapshot: Session | null; deleted: boolean }

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

// Apply one legacy event to the running fold state (verbatim from the event-sourced
// store, including the sdkSessionId drop on truncate/compact — ADR 0058).
function applyEvent(state: FoldState, e: LegacySessionEvent): void {
  if (e.type === 'session.created') {
    state.snapshot = { ...e.session, messages: [...(e.session.messages ?? [])] }
  } else if (e.type === 'session.metadata.updated') {
    if (!state.snapshot) return
    state.snapshot = { ...state.snapshot, ...e.patch, updatedAt: e.at }
  } else if (e.type === 'message.appended') {
    if (!state.snapshot) return
    const current = state.snapshot
    // Upsert by message id: a turn is appended user → partial → final under the
    // same id (last write wins). Legacy logs with a unique id per event collapse
    // this to a plain push.
    const idx = current.messages.findIndex((m) => m.id === e.message.id)
    const messages =
      idx >= 0
        ? current.messages.map((m, i) => (i === idx ? e.message : m))
        : [...current.messages, e.message]
    state.snapshot = { ...current, messages, updatedAt: e.at }
  } else if (e.type === 'message.progress') {
    if (!state.snapshot) return
    const current = state.snapshot
    const idx = current.messages.findIndex((m) => m.id === e.id)
    // Lazily materialise the assistant message on the first delta so a crash
    // before any `message.appended` still surfaces the partial reply.
    const base: SessionMessage =
      idx >= 0 ? current.messages[idx] : { id: e.id, role: 'agent', text: '', at: e.at }
    let steps = base.steps
    if (e.steps && e.steps.length) {
      // Merge step deltas by id (a running → done re-emit replaces in place).
      const merged = [...(base.steps ?? [])]
      for (const s of e.steps) {
        const si = merged.findIndex((x) => x.id === s.id)
        if (si >= 0) merged[si] = s
        else merged.push(s)
      }
      steps = merged
    }
    const next: SessionMessage = {
      ...base,
      text: (base.text ?? '') + (e.textDelta ?? ''),
      at: e.at,
      ...(steps && steps.length ? { steps } : {}),
    }
    const messages =
      idx >= 0
        ? current.messages.map((m, i) => (i === idx ? next : m))
        : [...current.messages, next]
    state.snapshot = { ...current, messages, updatedAt: e.at }
  } else if (e.type === 'session.truncated') {
    if (!state.snapshot) return
    // Drop sdkSessionId: a real truncation rewrites history, so the Claude SDK
    // resume handle is stale (ADR 0058). state.snapshot is only reassigned when we
    // actually truncate; an unknown keepThroughId leaves it (and sdkSessionId) intact.
    const { sdkSessionId: _staleSdk, ...current } = state.snapshot
    if (e.keepThroughId === null) {
      state.snapshot = { ...current, messages: [], updatedAt: e.at }
    } else {
      const idx = current.messages.findIndex((m) => m.id === e.keepThroughId)
      if (idx >= 0) {
        state.snapshot = {
          ...current,
          messages: current.messages.slice(0, idx + 1),
          updatedAt: e.at,
        }
      }
    }
  } else if (e.type === 'session.compacted') {
    if (!state.snapshot) return
    // Drop sdkSessionId: a compaction supersedes the Claude SDK session (ADR 0058).
    const { sdkSessionId: _supersededSdk, ...current } = state.snapshot
    // Only accept a checkpoint whose cut point still exists in the transcript.
    const known = current.messages.some((m) => m.id === e.compaction.firstKeptMessageId)
    if (known) state.snapshot = { ...current, compaction: e.compaction, updatedAt: e.at }
  } else if (e.type === 'session.deleted') {
    state.deleted = true
  }
}

function parseLegacyLine(line: string): LegacySessionEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as LegacySessionEvent
  } catch {
    return null
  }
}

// Stream the JSONL line-by-line and fold. Streaming (not readFile) is mandatory:
// a legacy log bloated by mid-stream progress events can exceed V8's max string
// length, which would throw on a single-string read and lose the session.
async function foldLegacy(file: string): Promise<FoldState> {
  const state: FoldState = { snapshot: null, deleted: false }
  const stream = createReadStream(file, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      const evt = parseLegacyLine(line)
      if (evt) applyEvent(state, evt)
    }
  } finally {
    rl.close()
    stream.destroy()
  }
  return state
}

// ─── Classification + per-file migration ──────────────────────────────────────

// A flat file worth migrating is either a legacy event log or an interim single-file
// header+messages file; anything else (empty / corrupt / foreign) is left untouched.
type FlatKind = 'legacy' | 'new' | 'other'

// Read only the first line. readline emits a COMPLETE line (buffering across chunks
// until the first newline), so this never loads the whole — possibly huge — file.
async function peekFirstLine(file: string): Promise<string | null> {
  const stream = createReadStream(file, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      return line
    }
    return null
  } finally {
    rl.close()
    stream.destroy()
  }
}

// Classify a FLAT session file from its first line. An interim single-file header has
// a top-level `id` + numeric `messageCount`; a legacy event log's first line has a
// string `type`. Anything else (empty / corrupt / foreign) is left untouched.
async function classifyFlat(file: string): Promise<FlatKind> {
  const first = await peekFirstLine(file)
  if (!first) return 'other'
  let parsed: unknown
  try {
    parsed = JSON.parse(first)
  } catch {
    return 'other'
  }
  if (typeof parsed !== 'object' || parsed === null) return 'other'
  const obj = parsed as Record<string, unknown>
  if (typeof obj.id === 'string' && typeof obj.messageCount === 'number') return 'new'
  if (typeof obj.type === 'string') return 'legacy'
  return 'other'
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

// Fold/parse a flat file into a full Session. A legacy log is folded via the retained
// reducer (a `session.deleted` tombstone yields `{ deleted: true }`); an interim flat
// single-file is parsed header+messages (stripping the pre-computed header fields).
// Returns null when the file yields no session (empty / corrupt).
async function loadFlatSession(
  file: string,
  kind: 'legacy' | 'new',
): Promise<{ session: Session } | { deleted: true } | null> {
  if (kind === 'legacy') {
    const state = await foldLegacy(file)
    if (state.deleted) return { deleted: true }
    if (!state.snapshot) return null
    return { session: state.snapshot }
  }
  const parsed = readSessionJsonl(file)
  if (!parsed) return null
  const { messageCount: _mc, preview: _pv, status: _st, lastPreview: _lp, ...meta } = parsed.header
  return { session: { ...meta, messages: parsed.messages } }
}

// Migrate one flat file to the folder layout. Idempotent + crash-safe: back up FIRST,
// write the folder, then unlink the flat file (the .bak remains as the backup).
async function migrateFlatFile(file: string): Promise<'migrated' | 'skipped'> {
  const kind = await classifyFlat(file)
  if (kind === 'other') return 'skipped'
  const result = await loadFlatSession(file, kind)
  if (!result) return 'skipped'
  // A `session.deleted` tombstone → do not resurrect it. RETIRE the flat file out of
  // the `.jsonl` namespace (infosec F4) so it isn't re-folded (streamed) every boot.
  // Never clobber an existing retired file; if one exists, just remove the leftover.
  if ('deleted' in result) {
    const retired = `${file}.deleted.bak`
    try {
      if (await pathExists(retired)) await unlink(file)
      else await rename(file, retired)
    } catch {
      /* best-effort — a failure just means it's re-checked next boot */
    }
    return 'skipped'
  }
  const { session } = result
  // Back up the flat file BEFORE any destructive step (never clobber an existing .bak).
  const bak = `${file}.bak`
  if (!(await pathExists(bak))) await copyFile(file, bak)
  // Write the folder layout. mkdir of attachments/ creates {id}/ too (recursive);
  // writeSessionJsonl then writes {id}/session.jsonl atomically and externalizes any
  // base64 attachments into {id}/attachments/. Paths derive from session.id so a later
  // persist (keyed by header.id) targets this same folder.
  await mkdir(attachmentsDir(session.id), { recursive: true, mode: 0o700 })
  writeSessionJsonl(sessionFilePath(session.id), session)
  // Remove the flat file so it isn't rescanned; the .bak remains as the backup. A crash
  // before this leaves the flat file + .bak → re-migrated (harmlessly) next boot.
  try {
    await unlink(file)
  } catch (err) {
    if (!isMissing(err)) throw err
  }
  return 'migrated'
}

// Remove a stale sessions/index.json (the old ADR 0048 derived cache). Header-per-file
// is the index now, so the JSON cache is obsolete and would only go stale.
async function removeStaleIndex(): Promise<void> {
  try {
    await unlink(join(sessionsDir(), 'index.json'))
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('session-migration: failed to remove stale index.json', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

// Scan the sessions dir once and migrate every flat file to the folder layout.
// Best-effort per file: a failure is logged and skipped so one bad file never blocks
// the rest. Directory entries are already in the target layout → left alone.
export async function migrateLegacySessions(): Promise<void> {
  await removeStaleIndex()
  let entries: Dirent[]
  try {
    entries = await readdir(sessionsDir(), { withFileTypes: true })
  } catch (err) {
    if (isMissing(err)) return
    throw err
  }
  let migrated = 0
  let skipped = 0
  for (const entry of entries) {
    if (entry.isDirectory()) continue
    if (!entry.name.endsWith('.jsonl')) continue
    const file = join(sessionsDir(), entry.name)
    try {
      const outcome = await migrateFlatFile(file)
      if (outcome === 'migrated') migrated += 1
      else skipped += 1
    } catch (err) {
      skipped += 1
      log.warn('session-migration: failed to migrate flat file', {
        file,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  if (migrated > 0) {
    log.info('session-migration: migrated flat session files to folder layout', {
      migrated,
      skipped,
    })
  }
}
