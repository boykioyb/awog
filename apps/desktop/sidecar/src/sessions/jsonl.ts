// Folder-per-session JSONL storage (craft-parity core, ADR 0062 storage + optional
// phase). On-disk layout:
//   ~/.awog/sessions/{id}/session.jsonl   line 1 = SessionHeader, lines 2+ = messages
//   ~/.awog/sessions/{id}/attachments/    externalized image/PDF attachment bytes
//
// The header carries pre-computed messageCount/preview/status/lastPreview so the
// session list loads from KB of headers instead of folding every transcript. Writes
// rewrite the whole file atomically (tmp → rename), so — unlike the event-sourced
// log — the file size tracks the current transcript rather than growing per stream
// tick. Image/PDF attachment bytes are externalized to the sibling attachments/ dir
// (see the externalization block) so the JSONL stays small; that move is invisible
// above this layer — read rehydrates the inline `url` before returning.

import {
  openSync,
  readSync,
  closeSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import type {
  Session,
  SessionAttachment,
  SessionHeader,
  SessionMessage,
  SessionRestingStatus,
} from '../types/shared.js'

// ─── Storage paths ──────────────────────────────────────────────────────────

const SESSIONS_DIR_NAME = sanitizeChild('sessions')
const ATTACHMENTS_DIR_NAME = 'attachments'

// Directory holding one folder per session under the AWOG home.
export function sessionsDir(): string {
  return join(awogHome(), SESSIONS_DIR_NAME)
}

// A session's own folder: ~/.awog/sessions/{id}/ (holds session.jsonl + attachments/).
// sanitizeChild rejects '/', '\\' and '..' — defence in depth even though the RPC
// boundary should validate the id.
export function sessionDir(id: string): string {
  return join(sessionsDir(), sanitizeChild(id))
}

// Absolute path of a session's JSONL file: ~/.awog/sessions/{id}/session.jsonl.
export function sessionFilePath(id: string): string {
  return join(sessionDir(id), 'session.jsonl')
}

// Directory holding a session's externalized image/PDF attachment bytes:
// ~/.awog/sessions/{id}/attachments/ (see the externalization block below).
export function attachmentsDir(id: string): string {
  return join(sessionDir(id), ATTACHMENTS_DIR_NAME)
}

// ─── Path portability (deferred) ──────────────────────────────────────────────
// Absolute paths embedded in message content are written VERBATIM (not tokenized).
// A portable `{{SESSION_PATH}}` round-trip was removed (ADR 0062 review, infosec F3):
// in the single-file model the sessions dir is shared across all sessions, so the
// token matched little of value while risking (a) content corruption when a user
// types the literal token and (b) invalid-JSON → message loss on Windows back-slash
// paths (the token was substituted into the raw serialized line before JSON.parse).
// Real cross-machine portability belongs to the export/import phase, where it can act
// on parsed path VALUES rather than the raw line.

// ─── Pre-computed header fields ────────────────────────────────────────────────

const PREVIEW_MAX = 140
// Fast-path probe size for reading just the header line. 8KB covers the metadata for
// the vast majority of sessions; a longer header (e.g. a big compaction summary)
// falls back to a bounded read (see readFirstLine).
const HEADER_PROBE_BYTES = 8192
// Hard cap for the header fallback read so the boot header scan can never pull an
// unbounded (corrupt / pathological single-line) file into memory (infosec F5).
const MAX_HEADER_BYTES = 4 * 1024 * 1024

function isMissingErr(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

// Resting status of a session from its LAST message — a verbatim copy of the
// event-sourced store's statusFromLast so the new header→summary projection badges
// awaiting/error/done identically (KISS > DRY for this additive phase). An error turn
// → 'error'; an UNANSWERED top-level AskUserQuestion → 'awaiting' (subagent questions
// carry parentId and never gate the whole session); any other finished agent turn →
// 'done'; a trailing user/system message → 'done'; no messages → 'idle'.
function statusFromLast(last: SessionMessage | undefined): SessionRestingStatus {
  if (!last) return 'idle'
  if (last.role !== 'agent') return 'done'
  if (last.error) return 'error'
  const awaiting = last.steps?.some(
    (st) =>
      !st.parentId &&
      st.kind === 'question' &&
      (st.questions?.length ?? 0) > 0 &&
      !(st.answers?.length ?? 0),
  )
  return awaiting ? 'awaiting' : 'done'
}

// First user message, sanitized to a short list-row preview. Strips the structured
// blocks/mentions the composer injects and collapses whitespace. Ported from craft's
// extractPreview, adapted to AWOG's `text` field + `user` role.
function extractPreview(messages: SessionMessage[]): string | undefined {
  const firstUser = messages.find((m) => m.role === 'user')
  if (!firstUser?.text) return undefined
  const sanitized = firstUser.text
    .replace(/<edit_request>[\s\S]*?<\/edit_request>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[skill:(?:[\w-]+:)?[\w-]+\]/g, '')
    .replace(/\[source:[\w-]+\]/g, '')
    .replace(/\[file:[^\]]+\]/g, '')
    .replace(/\[folder:[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return sanitized.slice(0, PREVIEW_MAX) || undefined
}

// Build a SessionHeader from a full Session: strip `messages`, then pre-compute
// messageCount/preview/status/lastPreview so the list loads without the body.
export function createSessionHeader(session: Session): SessionHeader {
  const { messages, ...meta } = session
  const last = messages[messages.length - 1]
  const header: SessionHeader = {
    ...meta,
    messageCount: messages.length,
    status: statusFromLast(last),
  }
  const preview = extractPreview(messages)
  if (preview) header.preview = preview
  if (last?.text) header.lastPreview = last.text.slice(0, PREVIEW_MAX)
  return header
}

// ─── Attachment externalization (persistence boundary only) ──────────────────
// Image/PDF attachments carry their bytes inline as a `data:<mime>;base64,<...>` URL
// on SessionAttachment.url. Writing that inline would bloat the JSONL line and
// re-serialize the same megabytes on every debounced save; instead the bytes are
// written ONCE to `{sessionDir}/attachments/{att.id}` and the persisted JSON keeps
// only a `storedFile` reference. This is TRANSPARENT above this layer: read rehydrates
// `url` from the stored file, so runtime/context-builder + the UI see the exact same
// attachment shape as a freshly composed one — they never learn the bytes moved.

// Match a base64 data URL `data:<mime>;base64,<payload>`. Group 1 = mime (may be
// empty), group 2 = base64 payload. Only base64 data URLs are externalized (the
// composer emits base64 for pasted/attached images + PDFs); an http(s) url, a text
// `preview`, or a `path`-only attachment is persisted verbatim.
const BASE64_DATA_URL_RE = /^data:([^;,]*);base64,([\s\S]*)$/

function parseBase64DataUrl(url: string): { mime: string; base64: string } | null {
  const m = BASE64_DATA_URL_RE.exec(url)
  if (!m) return null
  return { mime: m[1] ?? '', base64: m[2] ?? '' }
}

// A session's attachments dir derived from the path of its session.jsonl (siblings):
// {sessionDir}/session.jsonl → {sessionDir}/attachments. The read/write functions know
// only the file path, so this keeps them in step with attachmentsDir(id).
function attachmentsDirForFile(sessionFile: string): string {
  return join(dirname(sessionFile), ATTACHMENTS_DIR_NAME)
}

// Return a serialization-ready COPY of a message with its image/PDF attachments
// externalized: bytes written once to {attachmentsDir}/{att.id}, the copy keeping only
// `storedFile` (the basename) with `url` omitted. The LIVE message/attachments are
// NEVER mutated — the UI + context-builder still need `url` in this process; only the
// persisted JSON drops it. A message with nothing to externalize is returned as-is (no
// clone), so an all-text transcript pays nothing.
function externalizeAttachmentsForWrite(
  message: SessionMessage,
  attsDir: string,
): SessionMessage {
  const atts = message.attachments
  if (!atts?.length) return message
  let changed = false
  const nextAtts = atts.map((att): SessionAttachment => {
    // Already externalized (a re-save during streaming / a later turn): keep only the
    // reference — drop the inline url from the persisted copy WITHOUT re-decoding or
    // re-writing the (already-on-disk) file.
    if (att.storedFile) {
      if (att.url === undefined) return att
      changed = true
      const { url: _omitted, ...rest } = att
      return rest
    }
    // Nothing inline to externalize (text preview / path / http url) → persist verbatim.
    if (!att.url) return att
    const parsed = parseBase64DataUrl(att.url)
    if (!parsed) return att
    try {
      mkdirSync(attsDir, { recursive: true, mode: 0o700 })
      const fileName = sanitizeChild(att.id)
      writeFileSync(join(attsDir, fileName), Buffer.from(parsed.base64, 'base64'), {
        mode: 0o600,
      })
      changed = true
      const { url: _omitted, ...rest } = att
      return { ...rest, storedFile: fileName }
    } catch (err) {
      // A failed externalization must not lose the attachment — persist it inline.
      log.warn('jsonl: failed to externalize attachment, keeping inline', {
        attachmentId: att.id,
        err: err instanceof Error ? err.message : String(err),
      })
      return att
    }
  })
  return changed ? { ...message, attachments: nextAtts } : message
}

// Rehydrate externalized attachments in place on a freshly JSON.parsed message: read
// {attachmentsDir}/{storedFile}, base64-encode, restore `url` as a data URL. The parsed
// message is not shared with any live object, so mutating it is safe. A missing file
// leaves `url` undefined + logs a warn (a lost attachment must not nuke the transcript).
function rehydrateAttachmentsForRead(message: SessionMessage, attsDir: string): void {
  const atts = message.attachments
  if (!atts?.length) return
  for (const att of atts) {
    if (!att.storedFile || att.url !== undefined) continue
    try {
      const bytes = readFileSync(join(attsDir, sanitizeChild(att.storedFile)))
      const mime = att.mime || 'application/octet-stream'
      att.url = `data:${mime};base64,${bytes.toString('base64')}`
    } catch (err) {
      log.warn('jsonl: externalized attachment file missing on read', {
        attachmentId: att.id,
        storedFile: att.storedFile,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

// ─── Reading ────────────────────────────────────────────────────────────────

// Distinguish a new-format header (top-level id + numeric messageCount) from a legacy
// event-sourced line (whose first line is a `session.created` event with a string
// `type` and no top-level messageCount). Keeps readSessionHeader from returning
// garbage for files still in the old format during the migration window.
function isSessionHeader(value: unknown): value is SessionHeader {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && typeof v.messageCount === 'number'
}

// Read just the first line. Fast path: one 8KB fd read covers the header for the vast
// majority of sessions. Fallback: when the header is longer than the probe, read up
// to MAX_HEADER_BYTES to find the newline; a file with no newline within the cap is
// returned truncated (it then fails isSessionHeader → the session is skipped) so a
// pathological file can never be pulled wholesale into memory.
function readFirstLine(sessionFile: string): string {
  const fd = openSync(sessionFile, 'r')
  let chunk: string
  let filled: boolean
  try {
    const buffer = Buffer.alloc(HEADER_PROBE_BYTES)
    const bytesRead = readSync(fd, buffer, 0, HEADER_PROBE_BYTES, 0)
    chunk = buffer.toString('utf-8', 0, bytesRead)
    filled = bytesRead === HEADER_PROBE_BYTES
  } finally {
    closeSync(fd)
  }
  const nl = chunk.indexOf('\n')
  if (nl >= 0) return chunk.slice(0, nl)
  // No newline in the probe. If it did not fill the buffer the file is a single line
  // (a header-only session with no messages yet) → return it. Otherwise the header is
  // longer than the probe → bounded fallback read.
  if (!filled) return chunk
  const fd2 = openSync(sessionFile, 'r')
  try {
    const big = Buffer.alloc(MAX_HEADER_BYTES)
    const n = readSync(fd2, big, 0, MAX_HEADER_BYTES, 0)
    const text = big.toString('utf-8', 0, n)
    const i = text.indexOf('\n')
    return i >= 0 ? text.slice(0, i) : text
  } finally {
    closeSync(fd2)
  }
}

// Read only the header (line 1). Returns null on missing/corrupt/old-format files so
// callers can skip them without crashing the list load.
export function readSessionHeader(sessionFile: string): SessionHeader | null {
  try {
    const firstLine = readFirstLine(sessionFile)
    const parsed: unknown = JSON.parse(firstLine)
    return isSessionHeader(parsed) ? parsed : null
  } catch (err) {
    // A missing file is a normal, expected case (the persistence queue reads the
    // header of a not-yet-written new session to check for external metadata edits) —
    // return null silently. Only a real read/parse failure is worth a warning.
    if (isMissingErr(err)) return null
    log.warn('jsonl: failed to read session header', {
      file: sessionFile,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// Parse message lines resiliently: skip a line that fails JSON.parse (e.g. one
// truncated by a crash mid-write) rather than losing every message. Logs the line
// length only — never the content (infosec F7: content stays out of the local log).
function parseMessagesResilient(lines: string[], attsDir: string): SessionMessage[] {
  const messages: SessionMessage[] = []
  for (const line of lines) {
    try {
      const msg = JSON.parse(line) as SessionMessage
      rehydrateAttachmentsForRead(msg, attsDir)
      messages.push(msg)
    } catch {
      log.warn('jsonl: skipping corrupted message line', { length: line.length })
    }
  }
  return messages
}

// Read only the messages (lines 2+), skipping the header. Used for lazy loading when
// a session is opened.
//
// CRITICAL (infosec F1): a MISSING file (ENOENT) is a genuinely empty/new session →
// return []. Any OTHER read error (EIO/EACCES/EBUSY/AV-lock/…) is THROWN, never masked
// as an empty session — masking would let the caller set messagesLoaded=true and a
// later save would then atomically overwrite the real transcript with an empty file.
// readFileSync is safe here because the single-file model keeps files bounded (one
// atomic rewrite per save; no per-tick append bloat).
export function readSessionMessages(sessionFile: string): SessionMessage[] {
  let content: string
  try {
    content = readFileSync(sessionFile, 'utf-8')
  } catch (err) {
    if (isMissingErr(err)) return []
    throw err
  }
  const lines = content.split('\n').filter(Boolean)
  return parseMessagesResilient(lines.slice(1), attachmentsDirForFile(sessionFile))
}

// Read the full session (header + messages) in a single file read. Returns null on
// missing/corrupt/old-format files so a per-file failure skips that session rather
// than aborting a whole scan (used by listFullSessions / search).
export function readSessionJsonl(
  sessionFile: string,
): { header: SessionHeader; messages: SessionMessage[] } | null {
  try {
    const content = readFileSync(sessionFile, 'utf-8')
    const lines = content.split('\n').filter(Boolean)
    const firstLine = lines[0]
    if (!firstLine) return null
    const parsed: unknown = JSON.parse(firstLine)
    if (!isSessionHeader(parsed)) return null
    const messages = parseMessagesResilient(lines.slice(1), attachmentsDirForFile(sessionFile))
    return { header: parsed, messages }
  } catch (err) {
    log.warn('jsonl: failed to read session', {
      file: sessionFile,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// ─── Writing ────────────────────────────────────────────────────────────────

// Serialize a session to the JSONL body: header line + one message per line. Shared
// by the sync writeSessionJsonl and the async persistence queue so both serialize
// identically. `attsDir` is the session's attachments dir — image/PDF attachments are
// externalized into it and their inline `url` dropped from the persisted line (the
// live message keeps `url`; see externalizeAttachmentsForWrite). `headerOverride` lets
// the queue pass a metadata-merged header.
export function serializeSessionJsonl(
  session: Session,
  attsDir: string,
  headerOverride?: SessionHeader,
): string {
  const header = headerOverride ?? createSessionHeader(session)
  const lines = [
    JSON.stringify(header),
    ...session.messages.map((m) => JSON.stringify(externalizeAttachmentsForWrite(m, attsDir))),
  ]
  return `${lines.join('\n')}\n`
}

// Atomically replace `target` with `tmpFile` (sync). On POSIX, rename over an existing
// file is atomic — there is never a window with no file (infosec F2 / reviewer #5). On
// Windows rename fails if the target exists, so there we must unlink first (accepting
// the tiny non-atomic window that platform forces).
function atomicReplaceSync(tmpFile: string, target: string): void {
  if (process.platform === 'win32') {
    try {
      unlinkSync(target)
    } catch {
      /* ignore if it doesn't exist */
    }
  }
  renameSync(tmpFile, target)
}

// Write a session to disk atomically (write-to-temp-then-rename). If the process
// crashes mid-write, either the old file stays intact or the new file is fully written
// — never a partial file. Synchronous; the async debounced path lives in the queue.
export function writeSessionJsonl(sessionFile: string, session: Session): void {
  const dir = dirname(sessionFile)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const body = serializeSessionJsonl(session, attachmentsDirForFile(sessionFile))
  const tmpFile = `${sessionFile}.tmp`
  writeFileSync(tmpFile, body, { encoding: 'utf-8', mode: 0o600 })
  atomicReplaceSync(tmpFile, sessionFile)
}
