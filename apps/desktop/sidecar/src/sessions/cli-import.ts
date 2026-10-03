// "Open in CLI" — transcript importer. Gấp các entry MỚI mà một CLI bên ngoài
// (claude / codex / devin — spawn qua sessions/cli-registry.ts) đã viết vào
// transcript riêng của nó về transcript AWOG (`SessionMessage[]`), để phiên phản
// ánh cả phần hội thoại đã diễn ra trong PTY. Ba nguồn, ba định dạng:
//
//   claude — JSONL `<claudeHome>/projects/<cwd-hash>/<sdkSessionId>.jsonl`
//     (ADR 0070: home chung với Claude Code). File này là transcript CHUNG với
//     runtime claude-sdk của AWOG — `claude --resume <sdkSessionId>` viết TIẾP
//     vào đúng file đang chứa các lượt AWOG đã chạy (xem "shared history" dưới).
//   codex  — JSONL rollout `<codexHome>/sessions/<YYYY>/<MM>/<DD>/rollout-*-<threadId>.jsonl`
//     (Codex ≥0.154: mỗi dòng là phong bì `{timestamp, type, payload}`; codexHome
//     theo account — `~/.awog/codex/<accountId>`). `codex resume <threadId>` ghi
//     tiếp/fork rollout của đúng thread đó.
//   devin  — ATIF JSON `~/.local/share/devin/cli/transcripts/<name>.json`
//     (`{schema_version, steps:[...]}`). AWOG không có devin runtime nên phiên
//     devin luôn UNLINKED — importer chỉ kéo về để xem, file do CLI tự chọn.
//
// Dedupe hai lớp:
//   1. Con trỏ `Session.cliImport[kind]` persist trên header (byte offset cho
//      JSONL, số step cho devin) — lần sync sau chỉ đọc phần file chưa gặp. Một
//      dòng JSONL chỉ được consume khi kết thúc bằng '\n': phần đuôi chưa có
//      newline là entry đang ghi dở (sync có thể chạy khi CLI còn sống), để lại
//      cho lần sau — KHÔNG lùi về 0 mất entry. Cursor còn giữ bằng chứng spawn
//      (`pendingSdkSessionId`, `spawnedAt`) để importer sống qua restart
//      sidecar — registry in-memory mất thì các field này vẫn còn.
//   2. File "shared history" (claude/codex resume vào đúng runtime file của
//      phiên): các lượt AWOG ĐÃ chạy nằm trong file — trừ multiset theo
//      (role + text đã chuẩn hoá whitespace) khỏi message mới import để không
//      gấp lại bản sao của chính mình. Entry USER trong transcript có thể mang
//      scaffold runtime prepend (history prefix, <current_state>, style…) phía
//      TRƯỚC chữ thô mà AWOG persist — nên user còn được khớp SUFFIX (stored ≥
//      3 ký tự đã chuẩn hoá); assistant giữ exact-only vì scaffold không chạm
//      text của nó. Vẫn chấp nhận dup khi file bị truncate/rotate về 0 — hiếm,
//      và rẻ hơn là bỏ sót entry.
//
// Vòng đời đặc biệt của claude: spawn không-resume (`--session-id <uuid>`) giữ
// uuid trong `cliLastLinkFor().pendingSdkSessionId` VÀ persist vào cursor
// `cliImport.claude.pendingSdkSessionId`; khi file transcript thật tồn tại,
// importer NHẬN uuid đó làm sdkSessionId của phiên TRƯỚC khi import — lượt
// AWOG sau đó resume đúng phiên CLI đã tạo.
//
// Nguyên tắc chung: transcript của tool khác là dữ liệu L2 không tin cậy —
// parse phòng thủ, một dòng hỏng/lạ chỉ đếm+bỏ qua, không bao giờ làm cả lần
// sync đổ.
//
// Lưu ý vòng lặp import: cli-registry.ts import `importCliTranscript` từ đây
// (PTY onExit). Hai chiều chỉ gọi nhau BÊN TRONG hàm — không chạm nhau lúc
// module-eval nên ESM cycle này an toàn.

import { randomBytes } from 'node:crypto'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { awogHome, claudeHome } from '../util/path.js'
import { codexHomeFor } from '../runtime/codex/home.js'
import { cliLastLinkFor, resolveCliCwd } from './cli-registry.js'
import { appendMessage, loadSession, updateSessionMetadata } from './store.js'
import {
  stepFromQuestion,
  stepFromThinking,
  stepFromTodos,
  stepFromToolResult,
  stepFromToolUse,
  type ToolUseInfo,
} from './step-mapper.js'
import type {
  Session,
  SessionCliKind,
  SessionMessage,
  SessionMessagePart,
  SessionStep,
} from '../types/shared.js'

// ─── Public API ───────────────────────────────────────────────────────────────

// Serial hoá import theo PHIÊN: trigger PTY-exit (cli-registry onExit) không
// được chồng lên `sessions.syncCli` thủ công — cả hai append + ghi cursor trên
// cùng một transcript. Chuỗi promise: lần sau xếp sau lần trước, entry tự dọn
// khi chuỗi cạn để map không phình.
const importChains = new Map<string, Promise<void>>()

export async function importCliTranscript(
  sessionId: string,
  kind: SessionCliKind,
  opts?: { transcriptFile?: string },
): Promise<{ imported: number }> {
  const prev = importChains.get(sessionId) ?? Promise.resolve()
  const run = prev.then(() => runCliImport(sessionId, kind, opts))
  // Đuôi chuỗi nuốt lỗi để một sync hỏng không vỡ mọi lần xếp sau nó; lỗi thật
  // vẫn trả về cho CALLER qua `run` (reject lan truyền bình thường).
  const settled: Promise<void> = run.then(
    () => undefined,
    () => undefined,
  )
  importChains.set(sessionId, settled)
  try {
    return await run
  } finally {
    if (importChains.get(sessionId) === settled) importChains.delete(sessionId)
  }
}

// ─── Import core ──────────────────────────────────────────────────────────────

async function runCliImport(
  sessionId: string,
  kind: SessionCliKind,
  opts: { transcriptFile?: string } | undefined,
): Promise<{ imported: number }> {
  const emitDone = (imported: number): { imported: number } => {
    // Emit CẢ khi imported=0 — UI refresh để hiện "already up to date", và đây
    // là nhịp duy nhất phiên bảo đảm có sau mọi sync.
    emit('session.cli-synced', { sessionId, imported })
    return { imported }
  }

  const session = await loadSession(sessionId)
  if (!session) return { imported: 0 } // phiên đã xoá — không có gì để cập nhật

  const located = await locateTranscript(session, kind, opts?.transcriptFile)
  if (!located) return emitDone(0)
  const { file, shared } = located

  let messages: SessionMessage[]
  let nextOffset: number
  let skipped: Map<string, number>

  if (kind === 'devin') {
    const raw = await readFile(file, 'utf8').catch(() => undefined)
    if (raw === undefined) return emitDone(0) // file vừa được locate nhưng đã mất
    let doc: unknown
    try {
      doc = JSON.parse(raw)
    } catch {
      log.warn('cli import: devin transcript is not valid JSON', { sessionId, file })
      return emitDone(0)
    }
    const cursor = session.cliImport?.devin
    const start = cursor?.file === file && cursor.offset !== undefined ? cursor.offset : 0
    const parsed = parseDevinTranscript(doc, start, spawnFloor(session, kind, start, shared))
    messages = parsed.messages
    skipped = parsed.skipped
    nextOffset = parsed.nextOffset
  } else {
    let buf: Buffer
    try {
      buf = await readFile(file)
    } catch {
      return emitDone(0)
    }
    const cursor = session.cliImport?.[kind]
    const start = cursor?.file === file && cursor.offset !== undefined ? cursor.offset : 0
    const sliced = sliceJsonlTail(buf, start)
    const parsed =
      kind === 'claude'
        ? parseClaudeTranscript(sliced.text, spawnFloor(session, kind, start, shared))
        : parseCodexRollout(sliced.text, spawnFloor(session, kind, start, shared))
    messages = parsed.messages
    skipped = parsed.skipped
    nextOffset = sliced.nextOffset
  }

  // Shared-history dedupe: trừ các message transcript AWOG ĐÃ có khỏi phần mới
  // import — file claude/codex của phiên chứa cả các lượt SDK/app-server cũ.
  if (shared && messages.length > 0) {
    messages = subtractKnownMessages(messages, session.messages)
  }

  for (const message of messages) {
    await appendMessage(sessionId, message)
  }

  if (skipped.size > 0) {
    log.info('cli import: skipped transcript entries', {
      sessionId,
      kind,
      file: basename(file),
      skipped: Object.fromEntries(skipped),
    })
  }

  // Chỉ ghi cursor khi nó thật sự nhích — updateMetadata đụng updatedAt, một
  // nhịp sync rỗng không đáng đẩy phiên lên đầu danh sách gần đây. Merge trên
  // cursor cũ để không mất bằng chứng spawn (pendingSdkSessionId/spawnedAt) mà
  // registry persist sau khi mở PTY, và không đụng cursor của kind khác.
  const prev = session.cliImport?.[kind]
  if (!prev || prev.file !== file || prev.offset !== nextOffset) {
    await updateSessionMetadata(sessionId, {
      cliImport: { ...session.cliImport, [kind]: { ...prev, file, offset: nextOffset } },
    })
  }

  return emitDone(messages.length)
}

// Sàn thời gian khi mở file từ ĐẦU (start===0) trên file SHARED-HISTORY:
// mọi entry trước lúc spawn CLI là lượt AWOG cũ đã nằm trong transcript — lọc
// theo `link.spawnedAt` (trừ vài giây slack cho đồng hồ lệch), bảo hiểm cho
// trường hợp multiset dedupe trượt text (ví dụ text AWOG ghi khác text
// transcript giữ lại). KHÔNG áp trên file ngoài (devin / pending-fresh): phiên
// devin mà user `/resume` trong TUI có toàn bộ step trước spawn — sàn sẽ nuốt
// hết lịch sử đang muốn kéo về. Resume theo offset (start>0) cũng không áp:
// phần byte sau con trỏ đã được con trỏ phân định đúng.
function spawnFloor(
  session: Session,
  kind: SessionCliKind,
  start: number,
  shared: boolean,
): number | undefined {
  if (start !== 0 || !shared) return undefined
  const link = cliLastLinkFor(session.id)
  const spawnedAt =
    link && link.kind === kind ? link.spawnedAt : session.cliImport?.[kind]?.spawnedAt
  // Không còn bằng chứng spawn nào (registry restart + cursor sạch) → không áp
  // sàn; multiset dedupe vẫn là lớp chính trên shared history.
  if (spawnedAt === undefined) return undefined
  return spawnedAt - 5_000
}

// ─── Transcript location ─────────────────────────────────────────────────────

interface LocatedTranscript {
  file: string
  // true khi file này còn là transcript mà runtime AWOG của phiên ghi vào
  // (claude resume-file / codex rollout của thread) — các lượt AWOG cũ nằm
  // trong nó nên phải trừ khỏi phần import.
  shared: boolean
}

async function locateTranscript(
  session: Session,
  kind: SessionCliKind,
  explicitFile: string | undefined,
): Promise<LocatedTranscript | undefined> {
  if (explicitFile) {
    // Callers có thể truyền file cụ thể (devin unlinked cần vậy) — nhưng chỉ
    // nhận path NẰM TRONG root transcript của kind đó; file lạc ngoài root là
    // bề mặt đọc-file-tuỳ-ý qua RPC (invariant #2).
    const safe = await insideRoot(explicitFile, transcriptRootFor(kind))
    if (!safe) {
      log.warn('cli import: transcriptFile outside kind transcript root, ignored', {
        kind,
        file: explicitFile,
      })
      return undefined
    }
    try {
      if (!(await stat(safe)).isFile()) return undefined
    } catch {
      return undefined
    }
    const shared = isSessionRuntimeFile(session, kind, safe)
    if (!shared && kind === 'claude' && !session.sdkSessionId) {
      // Caller chỉ file thủ công nhưng đó LÀ file của pendingSdkSessionId → vẫn
      // phải adopt, để lượt AWOG sau resume đúng phiên CLI vừa tạo.
      const pending = pendingSdkIdFor(session)
      if (pending && basename(safe) === `${pending}.jsonl`) {
        await adoptClaudePending(session)
      }
    }
    return { file: safe, shared }
  }

  switch (kind) {
    case 'claude':
      return locateClaudeTranscript(session)
    case 'codex':
      return locateCodexRollout(session)
    case 'devin':
      return locateDevinTranscript(session)
  }
}

function transcriptRootFor(kind: SessionCliKind): string {
  switch (kind) {
    case 'claude':
      return join(claudeHome(), 'projects')
    case 'codex':
      return join(awogHome(), 'codex')
    case 'devin':
      return devinTranscriptsDir()
  }
}

function devinTranscriptsDir(): string {
  return join(homedir(), '.local', 'share', 'devin', 'cli', 'transcripts')
}

// Id ngoài (sdkSessionId claude / threadId codex) là L2 — chỉ cho phép charset
// an toàn trước khi đưa vào path join hoặc so tên file. `..`, '/', NUL và mọi
// ký tự lạ đều bị từ chối; giới hạn 128 khớp cỡ id thực tế (uuid=36, thread
// codex ~40) với headroom.
const CLI_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function isSafeCliId(id: string | undefined): id is string {
  return typeof id === 'string' && CLI_ID_RE.test(id)
}

// Path nằm trong root? realpath() CẢ HAI đầu rồi so prefix có separator — resolve()
// thuần chỉ xử `..` textual, còn symlink (`projects/evil -> /etc`) thì qua mặt
// được. Candidate hoặc root không tồn tại → realpath throw → undefined.
async function insideRoot(file: string, root: string): Promise<string | undefined> {
  let f: string
  let r: string
  try {
    ;[f, r] = await Promise.all([realpath(file), realpath(root)])
  } catch {
    return undefined
  }
  const prefix = r.endsWith(sep) ? r : `${r}${sep}`
  return f.startsWith(prefix) ? f : undefined
}

// File này có phải transcript mà runtime AWOG của CHÍNH phiên này ghi vào?
// Chỉ những file như vậy mới chứa các lượt cũ cần trừ multiset.
function isSessionRuntimeFile(session: Session, kind: SessionCliKind, file: string): boolean {
  switch (kind) {
    case 'claude':
      return (
        typeof session.sdkSessionId === 'string' &&
        basename(file) === `${session.sdkSessionId}.jsonl`
      )
    case 'codex':
      return (
        typeof session.codexThreadId === 'string' && basename(file).includes(session.codexThreadId)
      )
    case 'devin':
      return false
  }
}

// Claude: `<claudeHome>/projects/<cwd-hash>/<sdkSessionId>.jsonl` — quét mọi
// project-dir cho tới khi đụng (giống quét của removeSdkSession trong
// runtime/claude-sdk/store.ts), vì cwd-hash là định dạng nội bộ của CLI.
async function locateClaudeTranscript(session: Session): Promise<LocatedTranscript | undefined> {
  if (session.sdkSessionId) {
    const file = await findClaudeTranscriptFile(session.sdkSessionId)
    if (file) return { file, shared: true }
    return undefined
  }
  // Phiên chưa có sdkSessionId: spawn đã mint `--session-id <uuid>` và giữ nó
  // trong link.pendingSdkSessionId (+ persist ở cursor để sống qua restart).
  // File tồn tại → NHẬN uuid đó làm resume handle của phiên TRƯỚC khi import
  // (ghi ngay = treo handle vào file có thể không bao giờ được tạo). File mới
  // mint chỉ chứa entry của CLI → shared=false.
  const pending = pendingSdkIdFor(session)
  if (!pending) return undefined
  const file = await findClaudeTranscriptFile(pending)
  if (!file) return undefined
  await adoptClaudePending(session)
  // shared=false kể cả khi adoption thắng: file pending do CLI tạo chỉ chứa
  // entry của CLI — chưa lượt AWOG nào ghi vào nó (phiên chưa từng có handle).
  return { file, shared: false }
}

// pendingSdkSessionId từ link in-memory; registry map mất sau restart nên rớt
// về cursor đã persist trên header.
function pendingSdkIdFor(session: Session): string | undefined {
  const fromLink = cliLastLinkFor(session.id)?.pendingSdkSessionId
  const pending = fromLink ?? session.cliImport?.claude?.pendingSdkSessionId
  return isSafeCliId(pending) ? pending : undefined
}

// Adopt `pendingSdkSessionId` vào session.sdkSessionId. Race hiếm: người dùng
// gửi lượt AWOG trong khe giữa PTY-exit và sync này — lượt đó đã mint
// sdkSessionId khác; reload + kiểm lại trước khi ghi để không đè handle mới
// hơn. Khi adopt xong thì xoá luôn pending khỏi cursor persist (file đã được
// nhận handle chính thức). Trả uuid khi adopt được, undefined khi thua race.
async function adoptClaudePending(session: Session): Promise<string | undefined> {
  const pending = pendingSdkIdFor(session)
  if (!pending) return undefined
  const fresh = await loadSession(session.id)
  if (!fresh || fresh.sdkSessionId) return undefined
  // Xoá pending khỏi cursor (xoá KEY, không ghi undefined — exactOptional
  // PropertyTypes + JSON persist): id đã thành handle chính của phiên. Giữ
  // nguyên các field khác (file/offset/spawnedAt) và cursor của kind khác.
  const prevCursor = { ...(fresh.cliImport?.claude ?? {}) }
  delete prevCursor.pendingSdkSessionId
  const nextCliImport = { ...fresh.cliImport, claude: prevCursor }
  await updateSessionMetadata(session.id, {
    sdkSessionId: pending,
    cliImport: nextCliImport,
  })
  session.sdkSessionId = pending // giữ snapshot đồng bộ cho phần còn lại
  // Đồng bộ cả cliImport trên snapshot: bản ghi cursor cuối runCliImport merge
  // từ `session.cliImport[kind]` — nếu snapshot vẫn giữ pending cũ, nó sẽ ghi
  // NGƯỢC lại field vừa xoá.
  session.cliImport = nextCliImport
  return pending
}

async function findClaudeTranscriptFile(sdkSessionId: string): Promise<string | undefined> {
  if (!isSafeCliId(sdkSessionId)) {
    log.warn('cli import: refusing malformed claude sdkSessionId', { sdkSessionId })
    return undefined
  }
  const projects = join(claudeHome(), 'projects')
  let dirs
  try {
    dirs = await readdir(projects, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const candidate = join(projects, d.name, `${sdkSessionId}.jsonl`)
    try {
      if (!(await stat(candidate)).isFile()) continue
    } catch {
      continue // Entry đã biến mất giữa readdir và stat — quét tiếp.
    }
    // Candidate phải resolve THẬT nằm trong projects/ — một symlink `.jsonl`
    // trỏ ra ngoài là bề mặt đọc-file-tuỳ-ý (header L2 chọn sdkSessionId).
    const safe = await insideRoot(candidate, projects)
    if (safe) return safe
  }
  return undefined
}

// Codex: rollout `<home>/sessions/<YYYY>/<MM>/<DD>/rollout-<ts>-<threadId>.jsonl`.
// accountId của phiên chọn đúng `<awogHome>/codex/<accountId>`; thiếu thì quét
// mọi account-home (header là L2, tay có thể sửa). Cùng threadId có thể nằm ở
// NHIỀU file (resume/fork tạo rollout mới) — lấy file mới nhất mang tên đó; rớt
// tên thì dò nội dung (đổi naming qua các bản CLI).
async function locateCodexRollout(session: Session): Promise<LocatedTranscript | undefined> {
  const threadId = session.codexThreadId
  if (!threadId) return undefined
  if (!isSafeCliId(threadId)) {
    // threadId là header L2 — charset lạ (../, NUL…) thì từ chối quét thay vì
    // biến nó thành pattern `includes` trên mọi file trong ~/.awog/codex.
    log.warn('cli import: refusing malformed codex threadId', { sessionId: session.id })
    return undefined
  }
  for (const home of await codexHomes(session.settings?.accountId)) {
    const hit = await findCodexRollout(threadId, join(home, 'sessions'))
    // File tìm được QUA threadId (tên hoặc nội dung) chính là rollout của
    // thread phiên — chứa các lượt app-server cũ → shared.
    if (hit) return { file: hit, shared: true }
  }
  return undefined
}

async function codexHomes(accountId: string | undefined): Promise<string[]> {
  if (accountId) {
    // accountId đi vào path join — validate cùng charset để header bị sửa tay
    // (`../../etc`) không kéo importer ra khỏi ~/.awog/codex.
    if (!isSafeCliId(accountId)) {
      log.warn('cli import: refusing malformed codex accountId')
      return []
    }
    return [codexHomeFor(accountId)]
  }
  const root = join(awogHome(), 'codex')
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter((e) => e.isDirectory()).map((e) => join(root, e.name))
}

// Giới hạn dò nội-dung: chỉ quét file .jsonl nhỏ hơn 1MB, tối đa 50 file,
// sâu tối đa 6 cấp — ~/.awog/codex/** là L2 nhưng quét trần vẫn tốn kém.
const CODEX_SCAN_FILE_CAP = 50
const CODEX_SCAN_SIZE_CAP = 1_000_000
const CODEX_SCAN_DEPTH_CAP = 6

interface CodexFileInfo {
  file: string
  mtimeMs: number
  size: number
}

async function collectJsonlFiles(root: string, depth = 0): Promise<CodexFileInfo[]> {
  if (depth > CODEX_SCAN_DEPTH_CAP) return []
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const out: CodexFileInfo[] = []
  for (const e of entries) {
    const p = join(root, e.name)
    if (e.isDirectory()) {
      out.push(...(await collectJsonlFiles(p, depth + 1)))
    } else if (e.isFile() && e.name.endsWith('.jsonl')) {
      try {
        const st = await stat(p)
        out.push({ file: p, mtimeMs: st.mtimeMs, size: st.size })
      } catch {
        // file đã mất giữa readdir/stat — bỏ qua
      }
    }
  }
  return out
}

async function findCodexRollout(
  threadId: string,
  sessionsRoot: string,
): Promise<string | undefined> {
  const files = (await collectJsonlFiles(sessionsRoot)).sort((a, b) => b.mtimeMs - a.mtimeMs)
  // Mọi file trả về phải realpath nằm trong sessionsRoot — một file/symlink
  // trong cây sessions trỏ ra ngoài không được thành bề mặt đọc tự do.
  const inRoot = async (file: string): Promise<string | undefined> => insideRoot(file, sessionsRoot)
  // Đụng tên trước — file rollout chứa threadId trong basename.
  for (const f of files) {
    if (basename(f.file).includes(threadId)) {
      const safe = await inRoot(f.file)
      if (safe) return safe
    }
  }
  // Naming đổi qua các bản → dò NỘI DUNG (bounded): threadId xuất hiện trong
  // payload session_meta/thread metadata của rollout.
  let scanned = 0
  for (const f of files) {
    if (scanned >= CODEX_SCAN_FILE_CAP) break
    if (f.size > CODEX_SCAN_SIZE_CAP) continue
    scanned += 1
    try {
      const text = await readFile(f.file, 'utf8')
      if (text.includes(threadId)) {
        const safe = await inRoot(f.file)
        if (safe) return safe
      }
    } catch {
      // đọc lỗi → file tiếp
    }
  }
  return undefined
}

// Devin unlinked: không có handle phiên để nhắm file. Cursor cũ trỏ đúng file
// thì đọc tiếp nó (đừng nhảy sang transcript mới hơn của một phiên devin khác);
// chưa có cursor → chọn file .json mới-nhất được chạm TỪ lúc spawn trở đi
// (spawnedAt — link in-memory hoặc cursor persist — là bound thời gian duy nhất;
// devin TUI tự chọn session nội bộ, AWOG không biết tên file). KHÔNG có bằng
// chứng spawn nào thì KHÔNG dò: quét "file mới nhất" mù giờ sẽ nhặt nhầm
// transcript của một phiên devin khác — caller phải truyền transcriptFile tường
// minh trong trường hợp đó.
const DEVIN_MTIME_GRACE_MS = 5_000

// Bound thời gian MỘT MÌNH không đủ: devin mở ở project KHÁC sau floor vẫn trúng
// "file mới nhất" (transcript ATIF không ghi cwd ở metadata — top-level chỉ có
// schema_version/session_id/agent/steps). Dấu hiệu phân biệt duy nhất là nội
// dung: devin spawn trong workspace W chắc chắn ghi path của W vào transcript
// (rule injection `<rule path="<abs>/CLAUDE.md">`, env block, tool args dùng
// abs path). File ngoại không chứa path này → reject. Phiên devin chat-thuần
// không đụng file nào có thể không chứa path → reject là hướng AN TOÀN
// (miss còn hơn misimport — đây là bug người dùng đã gặp: sync húp transcript
// của project khác lên session này).
const DEVIN_CWD_SCAN_CAP = 16 * 1024 * 1024

async function devinTranscriptMatchesCwd(file: string, cwd: string): Promise<boolean> {
  try {
    const st = await stat(file)
    if (!st.isFile() || st.size > DEVIN_CWD_SCAN_CAP) return false
    const raw = await readFile(file, 'utf8')
    if (raw.includes(cwd)) return true
    // cwd trên đĩa có thể đi qua symlink (vd: /tmp → /private/tmp) — transcript
    // ghi path đã resolve, so cả hai dạng.
    const real = await realpath(cwd).catch(() => cwd)
    return real !== cwd && raw.includes(real)
  } catch {
    return false
  }
}

// Cursor `cliImport.devin` đang trỏ một file NGOẠI (transcript phiên devin của
// project khác trúng mtime-floor): gỡ file/offset nhưng GIỮ spawnedAt — nó vẫn
// là bằng chứng "AWOG đã spawn devin cho phiên này" cần cho discovery phía sau.
async function clearDevinCursorFile(session: Session): Promise<void> {
  const prev = { ...(session.cliImport?.devin ?? {}) }
  delete prev.file
  delete prev.offset
  const nextCliImport = { ...session.cliImport, devin: prev }
  await updateSessionMetadata(session.id, { cliImport: nextCliImport })
  // Đồng bộ snapshot — cùng lý do adoptClaudePending: runCliImport merge cursor
  // từ snapshot `session.cliImport` khi ghi, giữ nguyên bản cũ sẽ ghi ngược.
  session.cliImport = nextCliImport
}

async function locateDevinTranscript(session: Session): Promise<LocatedTranscript | undefined> {
  const dir = devinTranscriptsDir()
  const cwd = await resolveCliCwd(session).catch(() => undefined)
  const known = session.cliImport?.devin?.file
  if (known) {
    const safe = await insideRoot(known, dir)
    if (safe) {
      try {
        // File của cursor còn tồn tại → đọc tiếp chính nó, KHÔNG nhảy sang
        // file mới-nhất khác — nhưng phải qua kiểm chứng workspace trước:
        // cursor có thể đã bị nhiễm bởi một file ngoại trước khi có check.
        if ((await stat(safe)).isFile()) {
          // Không resolve được workspace → không verify được → không import
          // (NHƯNG cũng không xoá cursor — có thể project chỉ lỗi tạm).
          if (!cwd) return undefined
          if (await devinTranscriptMatchesCwd(safe, cwd)) {
            return { file: safe, shared: false }
          }
          log.warn('cli import: devin cursor points at a foreign transcript', {
            sessionId: session.id,
            file: safe,
            cwd,
          })
          await clearDevinCursorFile(session)
        }
      } catch {
        // file cũ đã mất → rơi xuống discovery có bound bên dưới.
      }
    }
  }
  const spawnedAt = devinSpawnEvidence(session)
  if (spawnedAt === undefined || !cwd) return undefined
  const floor = spawnedAt - DEVIN_MTIME_GRACE_MS
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return undefined
  }
  // Thử từng ứng viên mới→cũ: file mới nhất trúng floor mà thuộc project khác
  // phải bị bỏ qua, một file cũ hơn cùng workspace vẫn có thể là transcript đúng.
  const candidates: { file: string; mtimeMs: number }[] = []
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue
    const file = join(dir, e.name)
    try {
      const st = await stat(file)
      if (st.mtimeMs >= floor) candidates.push({ file, mtimeMs: st.mtimeMs })
    } catch {
      // bỏ qua file stat lỗi
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const cand of candidates.slice(0, 20)) {
    // Phòng thủ: file chọn được phải realpath nằm trong dir VÀ nội dung phải
    // chứng minh nó chạy trong workspace của phiên.
    const safe = await insideRoot(cand.file, dir)
    if (safe && (await devinTranscriptMatchesCwd(safe, cwd))) {
      return { file: safe, shared: false }
    }
  }
  return undefined
}

// Bằng chứng "AWOG đã spawn devin CLI cho phiên này": link in-memory của đúng
// kind devin, hoặc spawnedAt đã persist trong cursor (sống qua restart).
function devinSpawnEvidence(session: Session): number | undefined {
  const link = cliLastLinkFor(session.id)
  if (link && link.kind === 'devin') return link.spawnedAt
  return session.cliImport?.devin?.spawnedAt
}

// ─── Cursor slicing (JSONL byte-offset) ──────────────────────────────────────

// Chỉ consume đến newline cuối cùng: byte cuối file có thể là entry đang ghi
// dở — ăn nó sẽ làm JSON.parse rớt VÀ mất dòng đó vĩnh viễn (offset đã đi qua).
// offset > size ⇒ file bị truncate/rotate → đọc lại từ đầu (dup được chấp nhận,
// trừ multiset phía shared-history giảm phần lớn).
// offset rơi GIỮA dòng (header sửa tay, đệm lạ) ⇒ nhảy tới newline kế trước
// khi cắt.
export function sliceJsonlTail(
  buf: Buffer,
  offset: number,
): { text: string; nextOffset: number } {
  if (offset < 0 || !Number.isFinite(offset)) offset = 0
  if (offset > buf.length) offset = 0
  if (offset > 0 && buf[offset - 1] !== 0x0a) {
    const nl = buf.indexOf(0x0a, offset)
    if (nl < 0) return { text: '', nextOffset: buf.length }
    offset = nl + 1
  }
  const lastNl = buf.lastIndexOf(0x0a)
  const end = lastNl < 0 ? -1 : lastNl
  if (end < offset) return { text: '', nextOffset: offset }
  return { text: buf.toString('utf8', offset, end + 1), nextOffset: end + 1 }
}

// ─── Shared parsing helpers ──────────────────────────────────────────────────

type JsonObject = Record<string, unknown>

function asObject(v: unknown): JsonObject | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as JsonObject) : undefined
}
function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}
function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function mintCliMessageId(): string {
  // Charset [a-z0-9_-] thỏa MESSAGE_ID_RE — message id đi vào sink đường dẫn
  // attachments (sessions/ids.ts), không được mang ký tự lạ.
  return `msg_cli_${randomBytes(6).toString('hex')}`
}

// Entry timestamp: ISO string (cả 'Z' lẫn '+00:00') → ms; không parse được →
// undefined thay vì NaN rò vào filter.
function entryMs(v: unknown): number | undefined {
  const s = asString(v)
  if (!s) return undefined
  const ms = Date.parse(s)
  return Number.isFinite(ms) ? ms : undefined
}

export interface CliParseResult {
  messages: SessionMessage[]
  // Entry bị bỏ qua, đếm theo lý do — importer log MỘT lần; một dòng hỏng/lạ
  // không bao giờ được làm cả lần sync đổ.
  skipped: Map<string, number>
}

function bump(skipped: Map<string, number>, key: string): void {
  skipped.set(key, (skipped.get(key) ?? 0) + 1)
}

// Tích luỹ MỘT lượt agent: các entry assistant/response-item liên tiếp gộp
// thành MỘT SessionMessage — cùng khuôn với một turn AWOG (text + steps +
// usage + modelUsed). `parts` giữ thứ tự text↔step để UI render đan xen đúng
// thứ tự thay vì dồn text lên đầu; `pendingCalls` nhớ tool_use chưa thấy
// output để *_output/tool_result gập vào ĐÚNG step thay vì thành message rời.
interface TurnAcc {
  parts: SessionMessagePart[]
  texts: string[]
  steps: SessionStep[]
  pendingCalls: Map<string, { name: string; input: Record<string, unknown>; step: SessionStep }>
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  model?: string
  at?: string
}

function newTurn(): TurnAcc {
  return {
    parts: [],
    texts: [],
    steps: [],
    pendingCalls: new Map(),
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
}

function appendTurnText(t: TurnAcc, text: string): void {
  t.texts.push(text)
  const last = t.parts[t.parts.length - 1]
  if (last && last.kind === 'text') {
    last.text = `${last.text}\n${text}`
  } else {
    t.parts.push({ kind: 'text', text })
  }
}

function pushTurnStep(t: TurnAcc, step: SessionStep): void {
  t.steps.push(step)
  t.parts.push(step)
}

function flushTurn(t: TurnAcc, via: SessionCliKind, out: SessionMessage[]): void {
  // Transcript là lịch sử: mọi step còn treo 'running' (tool_use chưa có
  // tool_result trong phần file đã đọc) kết là 'done' — không có "đang chạy"
  // khi xem lại, và step treo sẽ quay spinner mãi trong UI.
  for (const s of t.steps) {
    if (s.status === 'running') s.status = 'done'
  }
  const text = t.texts.join('\n').trim()
  if (!text && t.steps.length === 0) return // turn trống (entry assistant rỗng)
  const msg: SessionMessage = {
    id: mintCliMessageId(),
    role: 'agent',
    text,
    at: t.at ?? new Date().toISOString(),
    via,
  }
  if (t.steps.length > 0) msg.steps = t.steps
  if (t.parts.length > 0) msg.parts = t.parts
  if (t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens > 0) {
    msg.usage = {
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      ...(t.cacheReadTokens > 0 ? { cacheReadTokens: t.cacheReadTokens } : {}),
      ...(t.cacheWriteTokens > 0 ? { cacheWriteTokens: t.cacheWriteTokens } : {}),
    }
  }
  if (t.model) msg.modelUsed = t.model
  out.push(msg)
}

function cliUserMessage(text: string, at: string | undefined, via: SessionCliKind): SessionMessage {
  return { id: mintCliMessageId(), role: 'user', text, at: at ?? new Date().toISOString(), via }
}

// Trừ multiset các message transcript AWOG ĐÃ có (key = role + text bỏ hết
// whitespace — khoảng trắng/newline khác nhau giữa hai nguồn không được đánh
// lừa dedupe). Chỉ áp dụng trên file "shared history": file đó chứa nguyên
// các lượt AWOG đã chạy nên text trùng CHẮC CHẮN là bản sao.
//
// Ngoại lệ USER: runtime prepend scaffold (history prefix `<conversation_so_far>`
// / `<summary_of_earlier_conversation>`, `<current_state>`, style/checklist/plan
// prompt…) TRƯỚC chữ thô user gõ — file transcript giữ bản scaffold còn AWOG
// chỉ persist text thô. Vì scaffold luôn nằm TRƯỚC, text thô là SUFFIX của bản
// transcript → khớp đuôi (sau khi exact miss) cho role 'user' khi text stored
// đã chuẩn hoá ≥ 3 ký tự. Assistant giữ exact-only: scaffold không đụng text
// của nó, và suffix trên assistant sẽ nuốt cả các câu trả lời CLI thật tình cờ
// trùng đuôi (không có bound nào để phân biệt).
const SUFFIX_DEDUPE_MIN_LEN = 3

function subtractKnownMessages(
  imported: SessionMessage[],
  existing: SessionMessage[],
): SessionMessage[] {
  const norm = (s: string): string => s.replace(/\s+/g, '')
  const keyOf = (m: SessionMessage): string => `${m.role}:${norm(m.text)}`
  const pool = new Map<string, number>()
  // Text user đã persist — pool suffix (mỗi entry vẫn bị cùng multiset đếm qua
  // `pool`, nên bản trùng stored không khớp quá số lần nó xuất hiện).
  const userTexts: { norm: string; key: string }[] = []
  for (const m of existing) {
    const key = keyOf(m)
    pool.set(key, (pool.get(key) ?? 0) + 1)
    if (m.role === 'user') userTexts.push({ norm: norm(m.text), key })
  }
  const out: SessionMessage[] = []
  for (const m of imported) {
    const key = keyOf(m)
    const left = pool.get(key) ?? 0
    if (left > 0) {
      pool.set(key, left - 1)
      continue // bản sao của một lượt AWOG đã có — không append lần hai
    }
    if (m.role === 'user') {
      const n = norm(m.text)
      const hit = userTexts.find(
        (u) => u.norm.length >= SUFFIX_DEDUPE_MIN_LEN && n.endsWith(u.norm) && (pool.get(u.key) ?? 0) > 0,
      )
      if (hit) {
        pool.set(hit.key, (pool.get(hit.key) ?? 0) - 1)
        continue // bản scaffold của một user-turn AWOG đã lưu — bỏ
      }
    }
    out.push(m)
  }
  return out
}

// ─── Claude JSONL parser ─────────────────────────────────────────────────────

// Khuôn entry Claude Code: {type:'user'|'assistant'|'summary'|..., uuid,
// parentUuid, timestamp, isMeta?, isSidechain?, message:{role,content,model?,
// usage?}}. Lọc meta/sidechain/tool_result; gộp các entry assistant liên tiếp
// thành một turn (text + tool_use steps + usage cộng dồn + model cuối).
export function parseClaudeTranscript(text: string, sinceMs?: number): CliParseResult {
  const out: SessionMessage[] = []
  const skipped = new Map<string, number>()
  let turn: TurnAcc | undefined
  const openTurn = (): TurnAcc => (turn ??= newTurn())
  const flush = (): void => {
    if (turn) {
      flushTurn(turn, 'claude', out)
      turn = undefined
    }
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      bump(skipped, 'unparseable')
      continue
    }
    const e = asObject(entry)
    if (!e) {
      bump(skipped, 'non-object')
      continue
    }
    if (e.isMeta === true) {
      bump(skipped, 'meta')
      continue
    }
    if (e.isSidechain === true) {
      bump(skipped, 'sidechain')
      continue
    }
    // Sàn spawn-time (chỉ khi mở file từ offset 0 trên shared history): entry
    // trước lúc CLI mở là lượt AWOG cũ — có timestamp thì lọc, không có thì giữ
    // (không định tuổi được thì không gán là "cũ").
    if (sinceMs !== undefined) {
      const ms = entryMs(e.timestamp)
      if (ms !== undefined && ms < sinceMs) {
        bump(skipped, 'pre-spawn')
        continue
      }
    }
    const ts = asString(e.timestamp)

    if (e.type === 'user') {
      const message = asObject(e.message)
      const content = message?.content
      if (typeof content === 'string') {
        flush()
        if (content.trim()) out.push(cliUserMessage(content, ts, 'claude'))
        else bump(skipped, 'user:empty')
        continue
      }
      const blocks = asArray(content)
      const isToolResults =
        blocks.length > 0 && blocks.every((b) => asObject(b)?.type === 'tool_result')
      if (isToolResults) {
        // tool_result nằm TRONG user-entry nhưng là output của tool_use lượt
        // trước → gập vào step đang treo, KHÔNG sinh user message.
        for (const b of blocks) foldClaudeToolResult(b, turn, skipped)
        continue
      }
      if (blocks.length === 0) {
        bump(skipped, 'user:empty')
        continue
      }
      flush()
      const text = blocks
        .map((b) => asObject(b))
        .filter((b): b is JsonObject => b !== undefined && b.type === 'text')
        .map((b) => asString(b.text) ?? '')
        .join('\n')
        .trim()
      if (text) out.push(cliUserMessage(text, ts, 'claude'))
      else bump(skipped, 'user:no-text') // user entry chỉ có image/document
      continue
    }

    if (e.type === 'assistant') {
      const message = asObject(e.message)
      if (!message) {
        bump(skipped, 'assistant:no-message')
        continue
      }
      const t = openTurn()
      if (ts) t.at = ts // timestamp CUỐI của turn thắng — gần lúc hoàn thành nhất
      const model = asString(message.model)
      if (model) t.model = model
      const usage = asObject(message.usage)
      if (usage) {
        t.inputTokens += asNumber(usage.input_tokens) ?? 0
        t.outputTokens += asNumber(usage.output_tokens) ?? 0
        t.cacheReadTokens += asNumber(usage.cache_read_input_tokens) ?? 0
        t.cacheWriteTokens += asNumber(usage.cache_creation_input_tokens) ?? 0
      }
      for (const b of asArray(message.content)) {
        const block = asObject(b)
        if (!block) continue
        const type = block.type
        if (type === 'text') {
          const s = asString(block.text)
          if (s) appendTurnText(t, s)
        } else if (type === 'thinking') {
          const s = asString(block.thinking)
          if (s) {
            const id = asString(e.uuid) ?? `think-${t.steps.length}`
            pushTurnStep(t, stepFromThinking(`think-${id}`, s, true))
          }
        } else if (type === 'tool_use') {
          addToolUseStep(t, block, asString(e.uuid), skipped)
        } else {
          bump(skipped, `block:${String(type)}`)
        }
      }
      continue
    }

    bump(skipped, `type:${String(e.type)}`)
  }
  flush()
  return { messages: out, skipped }
}

function addToolUseStep(
  t: TurnAcc,
  block: JsonObject,
  entryUuid: string | undefined,
  skipped: Map<string, number>,
): void {
  const name = asString(block.name)
  if (!name) {
    bump(skipped, 'tool_use:no-name')
    return
  }
  const id = asString(block.id) ?? `${entryUuid ?? 'cli'}-tu${t.steps.length}`
  const input = asObject(block.input) ?? {}
  const step = stepFromToolUse({ id, name, input })
  t.pendingCalls.set(id, { name, input, step })
  pushTurnStep(t, step)
}

// tool_result của Claude gập vào step đang treo cùng tool_use_id (nhìn thấy
// ở phần file trước); mồ côi (turn trước đã flush hoặc file cắt giữa chừng)
// thì bỏ — một result không có call thì không render được thành step có nghĩa.
function foldClaudeToolResult(
  rawBlock: unknown,
  turn: TurnAcc | undefined,
  skipped: Map<string, number>,
): void {
  const block = asObject(rawBlock)
  if (!block) return
  const toolUseId = asString(block.tool_use_id)
  const pending = toolUseId ? turn?.pendingCalls.get(toolUseId) : undefined
  if (!pending || !toolUseId) {
    bump(skipped, 'tool_result:orphan')
    return
  }
  const done = stepFromToolResult({
    toolUseId,
    toolName: pending.name,
    toolInput: pending.input,
    content: block.content,
    isError: block.is_error === true,
  })
  // Object.assign giữ object identity — step đã nằm trong steps[] và parts[]
  // nên cập nhật tại chỗ giữ đúng vị trí timeline.
  Object.assign(pending.step, done)
  turn?.pendingCalls.delete(toolUseId)
}

// ─── Codex rollout parser ────────────────────────────────────────────────────

// Codex ≥0.154 phong bì `{timestamp, ordinal, type, payload}`; payload của
// `response_item` chính là Responses-API item (message/reasoning/function_call/
// *_output/custom_tool_call/web_search_call/…); `event_msg` mang token_count;
// `turn_context` mang model hiện hành. Định dạng cũ/không phong bì: đọc thẳng
// dòng như một item. Mọi thứ không nhận ra → đếm + bỏ, KHÔNG throw.
export function parseCodexRollout(text: string, sinceMs?: number): CliParseResult {
  const out: SessionMessage[] = []
  const skipped = new Map<string, number>()
  let turn: TurnAcc | undefined
  let threadModel: string | undefined
  const openTurn = (): TurnAcc => {
    turn ??= newTurn()
    if (threadModel && !turn.model) turn.model = threadModel
    return turn
  }
  const flush = (): void => {
    if (turn) {
      flushTurn(turn, 'codex', out)
      turn = undefined
    }
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      bump(skipped, 'unparseable')
      continue
    }
    const e = asObject(entry)
    if (!e) {
      bump(skipped, 'non-object')
      continue
    }
    if (sinceMs !== undefined) {
      const ms = entryMs(e.timestamp)
      if (ms !== undefined && ms < sinceMs) {
        bump(skipped, 'pre-spawn')
        continue
      }
    }
    const ts = asString(e.timestamp)

    // Phong bì: chỉ envelope.type='response_item' mang item hội thoại; các loại
    // khác là ngữ cảnh/meta — móc token_count (usage per-request cuối turn) và
    // turn_context (model), còn lại đếm là skipped.
    let item: JsonObject
    if (typeof e.type === 'string' && e.payload !== undefined) {
      const payload = asObject(e.payload)
      switch (e.type) {
        case 'response_item':
          if (!payload) {
            bump(skipped, 'response_item:no-payload')
            continue
          }
          item = payload
          break
        case 'event_msg': {
          if (payload?.type === 'token_count') recordCodexTokenCount(payload, turn, openTurn)
          else bump(skipped, `event:${String(payload?.type)}`)
          continue
        }
        case 'turn_context': {
          const model = asString(payload?.model)
          if (model) {
            threadModel = model
            if (turn) turn.model = model
          }
          continue
        }
        default:
          bump(skipped, `envelope:${e.type}`)
          continue
      }
    } else {
      item = e // định dạng cũ / bare item — đọc thẳng
    }

    const itemType = asString(item.type) ?? ''
    switch (itemType) {
      case 'message':
        handleCodexMessage(item, ts, openTurn, flush, out, skipped)
        break
      case 'agent_message':
      case 'assistant_message': {
        const t = openTurn()
        if (ts) t.at = ts
        const s = codexItemText(item)
        if (s) appendTurnText(t, s)
        break
      }
      case 'reasoning': {
        const t = openTurn()
        if (ts) t.at = ts
        const s = codexReasoningText(item)
        if (s) {
          pushTurnStep(t, stepFromThinking(`codex-think-${t.steps.length}`, s, true))
        }
        break
      }
      case 'function_call':
      case 'custom_tool_call':
      case 'local_shell_call':
      case 'web_search_call':
      case 'tool_search_call':
        codexCallStep(openTurn(), item, ts, skipped)
        break
      case 'function_call_output':
      case 'custom_tool_call_output':
      case 'tool_search_output':
        foldCodexOutput(turn, item, skipped)
        break
      // Item-typed records of app-server / older variants (item.completed trên
      // wire dạng {type:'commandExecution'|...} đậu trong rollout): map vào đúng
      // khuôn step — commandExecution≈Bash, fileChange≈Edit (event-adapter).
      case 'commandExecution': {
        const t = openTurn()
        if (ts) t.at = ts
        codexCommandExecutionStep(t, item)
        break
      }
      case 'fileChange': {
        const t = openTurn()
        if (ts) t.at = ts
        codexFileChangeStep(t, item)
        break
      }
      default:
        bump(skipped, `item:${itemType || '?'}`)
    }
  }
  flush()
  return { messages: out, skipped }
}

// 'message' payload: role user/assistant + content blocks. User blocks đi kèm
// NHIỀU context tự inject — cả của codex CLI (environment_context,
// user_instructions, AGENTS.md, files-mentioned…) LẪN scaffold AWOG tự prepend
// vào promptText khi mở thread (runtime/codex/run-stream.ts + history-prefix:
// <current_state>, <conversation_so_far>, <summary_of_earlier_conversation>,
// <todo-list>) — không phải chữ người dùng gõ → lọc theo block.
const CODEX_INJECTED_RE =
  /^(<environment_context\b|<user_instructions\b|<skill\b|<permissions\b|<app-context\b|<collaboration_mode\b|<turn_aborted\b|<current_state\b|<conversation_so_far\b|<summary_of_earlier_conversation\b|<todo-list\b|#\s*AGENTS\.md instructions|#\s*Files mentioned by the user)/

function codexItemText(item: JsonObject): string {
  const parts: string[] = []
  for (const b of asArray(item.content)) {
    const block = asObject(b)
    if (!block) continue
    const t = asString(block.text)
    if (t) parts.push(t)
  }
  // Một số variant đặt text thẳng trên item thay vì block (`text` trên
  // bare-item cũ, `message` trên agent_message).
  if (parts.length === 0) {
    const t = asString(item.text) ?? asString(item.message)
    if (t) parts.push(t)
  }
  return parts.join('\n')
}

function handleCodexMessage(
  item: JsonObject,
  ts: string | undefined,
  openTurn: () => TurnAcc,
  flush: () => void,
  out: SessionMessage[],
  skipped: Map<string, number>,
): void {
  const role = asString(item.role) ?? ''
  // Block-level filter: một user item có thể trộn context inject + chữ thật.
  const userParts: string[] = []
  let allInjected = true
  let anyText = false
  for (const b of asArray(item.content)) {
    const block = asObject(b)
    if (!block) continue
    const t = asString(block.text)
    if (t === undefined) continue
    anyText = true
    if (CODEX_INJECTED_RE.test(t.trimStart())) continue
    allInjected = false
    userParts.push(t)
  }
  if (role === 'user') {
    let text = userParts.join('\n').trim()
    if (!text) {
      // Bare/older variant: text trần trên item, không qua content blocks.
      const fallback = asString(item.text) ?? asString(item.message)
      if (fallback && !CODEX_INJECTED_RE.test(fallback.trimStart())) {
        text = fallback.trim()
      }
    }
    if (!text) {
      // Toàn bộ content là context tự inject (environment_context, AGENTS.md…)
      // hoặc item không mang text nào — không phải chữ người dùng gõ.
      bump(skipped, anyText && allInjected ? 'message:injected-context' : 'message:empty')
      return
    }
    flush()
    out.push(cliUserMessage(text, ts, 'codex'))
    return
  }
  if (role === 'assistant') {
    const text = codexItemText(item)
    if (!text) return
    const t = openTurn()
    if (ts) t.at = ts
    appendTurnText(t, text)
    return
  }
  // developer/system/other roles: không phải user-visible message.
  bump(skipped, `message:${role || 'no-role'}`)
}

function codexReasoningText(item: JsonObject): string {
  const parts: string[] = []
  for (const key of ['summary', 'content'] as const) {
    for (const b of asArray(item[key])) {
      const block = asObject(b)
      const t = block ? asString(block.text) : undefined
      if (t) parts.push(t)
    }
  }
  return parts.join('\n')
}

// Tên tool codex → tên tool AWOG quen thuộc để label/icon đi đúng nhánh
// (commandExecution≈Bash, fileChange≈Edit theo event-adapter của runtime).
const CODEX_TOOL_NAME_MAP: Record<string, string> = {
  exec_command: 'Bash',
  shell_command: 'Bash',
  exec: 'Bash',
  shell: 'Bash',
  write_stdin: 'Bash',
  read_thread_terminal: 'Bash',
  local_shell_call: 'Bash',
  apply_patch: 'Edit',
  view_image: 'Read',
  web_search: 'WebSearch',
  web_search_call: 'WebSearch',
}

// args có thể là JSON-string (function_call.arguments), raw string
// (custom_tool_call.input — patch text), object, hoặc action.command[].
function codexCallInput(item: JsonObject): Record<string, unknown> {
  const raw = item.arguments ?? item.input
  if (typeof raw === 'string') {
    try {
      return asObject(JSON.parse(raw)) ?? {}
    } catch {
      return {}
    }
  }
  return asObject(raw) ?? {}
}

function codexCallStep(
  t: TurnAcc,
  item: JsonObject,
  ts: string | undefined,
  skipped: Map<string, number>,
): void {
  if (ts) t.at = ts
  const itemType = asString(item.type) ?? ''
  const callId = asString(item.call_id) ?? asString(item.id) ?? `codex-call-${t.steps.length}`

  // Special-cased calls: update_plan → 'note' checklist; request_user_input →
  // question card (cùng khuôn stepFromTodos/stepFromQuestion của nhánh live).
  const name = asString(item.name) ?? ''
  if (name === 'update_plan') {
    const args = codexCallInput(item)
    const plan = asArray(args.plan).map((p) => {
      const rec = asObject(p) ?? {}
      return { content: rec.step ?? rec.content, status: rec.status }
    })
    if (plan.length > 0) {
      pushTurnStep(t, stepFromTodos(callId, plan))
      return
    }
  }
  if (name === 'request_user_input') {
    const args = codexCallInput(item)
    pushTurnStep(t, stepFromQuestion(callId, args.questions, undefined, 'done'))
    return
  }

  let useName = name
  let input = codexCallInput(item)
  if (itemType === 'local_shell_call' || name === 'local_shell_call') {
    useName = 'Bash'
    const action = asObject(item.action)
    const command = asArray(action?.command)
      .map((c) => asString(c) ?? '')
      .filter((c) => c.length > 0)
      .join(' ')
    if (command) input = { command }
  } else if (itemType === 'web_search_call' || name === 'web_search') {
    useName = 'WebSearch'
    const action = asObject(item.action)
    const query = asString(action?.query) ?? asString(action?.url)
    input = query ? { query } : input
  } else if (useName === 'apply_patch') {
    // apply_patch payload là PATCH TEXT (không phải JSON) — rút target file để
    // step label hiện "Edit <file>" thay vì một cụm diff.
    const patch =
      asString(item.input) ?? asString(item.arguments) ?? asString(input.patch) ?? ''
    const m = patch.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/m)
    useName = 'Edit'
    input = m ? { file_path: m[1].trim() } : {}
  }
  // custom_tool_call với tên lạ (không phải apply_patch) giữ nguyên name —
  // stepFromToolUse render nó như một generic tool step.
  if (!useName) {
    bump(skipped, `call:no-name:${itemType}`)
    return
  }
  const mapped = CODEX_TOOL_NAME_MAP[useName] ?? useName
  // Codex shell calls để command là string[] — join về một dòng để
  // pickTarget/humanLabel hiện đúng câu lệnh.
  if (mapped === 'Bash' && Array.isArray(input.command)) {
    input = {
      ...input,
      command: input.command.map((c) => asString(c) ?? '').join(' ').trim(),
    }
  }
  const use: ToolUseInfo = { id: callId, name: mapped, input }
  const step = stepFromToolUse(use)
  t.pendingCalls.set(callId, { name: mapped, input, step })
  pushTurnStep(t, step)
}

// `commandExecution`/`fileChange` là item-type của app-server (khác payload
// function_call) — map về cùng khuôn Bash/Edit, đăng ký output theo item.id.
function codexCommandExecutionStep(t: TurnAcc, item: JsonObject): void {
  const callId = asString(item.id) ?? `codex-cmd-${t.steps.length}`
  const command = asString(item.command)
  const input: Record<string, unknown> = command ? { command } : {}
  const step = stepFromToolUse({ id: callId, name: 'Bash', input })
  // commandExecution item đã mang exit/output sẵn → gập luôn, không treo pending.
  const output = asString(item.aggregatedOutput) ?? asString(item.output)
  const exit = asNumber(item.exitCode)
  if (output !== undefined || exit !== undefined) {
    const done = stepFromToolResult({
      toolUseId: callId,
      toolName: 'Bash',
      toolInput: input,
      content: output ?? '',
      isError: exit !== undefined && exit !== 0,
    })
    Object.assign(step, done)
  } else {
    t.pendingCalls.set(callId, { name: 'Bash', input, step })
  }
  pushTurnStep(t, step)
}

function codexFileChangeStep(t: TurnAcc, item: JsonObject): void {
  const callId = asString(item.id) ?? `codex-file-${t.steps.length}`
  const changes = asArray(item.changes)
  const first = asObject(changes[0])
  const path = asString(first?.path) ?? asString(item.path)
  const input: Record<string, unknown> = path ? { file_path: path } : {}
  const step = stepFromToolUse({ id: callId, name: 'Edit', input })
  const status = asString(item.status)
  if (status === 'failed' || status === 'error') step.status = 'error'
  pushTurnStep(t, step)
}

function foldCodexOutput(
  turn: TurnAcc | undefined,
  item: JsonObject,
  skipped: Map<string, number>,
): void {
  const callId = asString(item.call_id) ?? asString(item.id)
  const pending = callId ? turn?.pendingCalls.get(callId) : undefined
  if (!pending || !callId) {
    bump(skipped, 'output:orphan')
    return
  }
  // output có thể là string hoặc {output:string, metadata} — lấy phần text.
  let output = asString(item.output)
  if (output === undefined) {
    const inner = asObject(item.output)
    output = asString(inner?.output) ?? ''
  }
  // exec_command output của codex kết bằng "Process exited with code N" —
  // non-zero ⇒ step 'error' để UI tô đỏ đúng như nhánh live.
  const exitMatch = /\bexit(?:ed)?(?:\s+with)?\s*code\s*:?\s*(\d+)/i.exec(output)
  const isError = exitMatch ? Number(exitMatch[1]) !== 0 : false
  const done = stepFromToolResult({
    toolUseId: callId,
    toolName: pending.name,
    toolInput: pending.input,
    content: output,
    isError,
  })
  Object.assign(pending.step, done)
  turn?.pendingCalls.delete(callId)
}

// token_count event: `info.last_token_usage` là usage của REQUEST cuối (per-
// request, cộng dồn như event-adapter đang làm — total_token_usage là tích
// luỹ cả thread nên không dùng).
function recordCodexTokenCount(
  payload: JsonObject,
  turn: TurnAcc | undefined,
  openTurn: () => TurnAcc,
): void {
  const info = asObject(payload.info)
  const last = asObject(info?.last_token_usage) ?? asObject(info?.lastTokenUsage)
  if (!last) return
  const t = turn ?? openTurn()
  t.inputTokens += asNumber(last.input_tokens) ?? 0
  t.outputTokens += asNumber(last.output_tokens) ?? 0
  t.cacheReadTokens +=
    asNumber(last.cached_input_tokens) ?? asNumber(last.cache_read_input_tokens) ?? 0
  t.cacheWriteTokens += asNumber(last.cache_write_input_tokens) ?? 0
}

// ─── Devin ATIF parser ───────────────────────────────────────────────────────

// ATIF: MỘT JSON document {schema_version, session_id, agent, steps:[…]} —
// không phải JSONL, nên cursor là SỐ STEP đã đọc chứ không phải byte offset.
// source user→user msg, agent→agent msg (một step = một message, không gộp),
// system→bỏ; source lạ có message→step trên agent message đang mở.
export function parseDevinTranscript(
  doc: unknown,
  offset: number,
  sinceMs?: number,
): CliParseResult & { nextOffset: number } {
  const out: SessionMessage[] = []
  const skipped = new Map<string, number>()
  const root = asObject(doc)
  const steps = root ? asArray(root.steps) : []
  const start = offset > 0 && offset <= steps.length ? offset : 0
  let lastAgent: SessionMessage | undefined

  for (const raw of steps.slice(start)) {
    const step = asObject(raw)
    if (!step) {
      bump(skipped, 'step:non-object')
      continue
    }
    if (sinceMs !== undefined) {
      const ms = entryMs(step.timestamp)
      if (ms !== undefined && ms < sinceMs) {
        bump(skipped, 'pre-spawn')
        continue
      }
    }
    const source = asString(step.source) ?? ''
    const message = asString(step.message) ?? ''
    const ts = asString(step.timestamp)
    const stepId = asString(step.step_id) ?? `d${start + out.length}`

    if (source === 'system') {
      bump(skipped, 'system')
      continue
    }
    if (source === 'user') {
      lastAgent = undefined
      if (!message.trim()) {
        bump(skipped, 'user:empty')
        continue
      }
      out.push(cliUserMessage(message, ts, 'devin'))
      continue
    }
    if (source === 'agent') {
      const msg = devinAgentMessage(step, stepId, ts)
      if (!msg) {
        bump(skipped, 'agent:empty')
        continue
      }
      out.push(msg)
      lastAgent = msg
      continue
    }
    // Source lạ (tool/vcs/internals…): có message → step trên agent message
    // đang mở; không có gì để treo thì bỏ qua an toàn.
    if (!message.trim()) {
      bump(skipped, `${source || 'unknown'}:empty`)
      continue
    }
    if (lastAgent) {
      const s: SessionStep = {
        id: `devin-${stepId}-${lastAgent.steps?.length ?? 0}`,
        kind: 'tool',
        label: source || 'Step',
        status: 'done',
        detail: { kind: 'text', content: clipText(message, 2_000) },
      }
      ;(lastAgent.steps ??= []).push(s)
      ;(lastAgent.parts ??= []).push(s)
      // Note: text of that agent message is unchanged — the step carries the
      // foreign-source output.
    } else {
      bump(skipped, `source:${source || '?'}`)
    }
  }
  return { messages: out, skipped, nextOffset: steps.length }
}

function clipText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text
}

function devinAgentMessage(
  step: JsonObject,
  stepId: string,
  ts: string | undefined,
): SessionMessage | undefined {
  const text = (asString(step.message) ?? '').trim()
  const parts: SessionMessagePart[] = []
  const steps: SessionStep[] = []
  const pending = new Map<string, { name: string; input: Record<string, unknown>; step: SessionStep }>()

  // reasoning_content → thinking step (đặt đầu — suy luận đi trước lời/tool).
  const reasoning = asString(step.reasoning_content)
  if (reasoning) {
    const s = stepFromThinking(`devin-${stepId}-think`, reasoning, true)
    steps.push(s)
    parts.push(s)
  }
  if (text) parts.push({ kind: 'text', text })

  // tool_calls → tool steps; observation.results gập output theo source_call_id.
  for (const call of asArray(step.tool_calls)) {
    const c = asObject(call)
    if (!c) continue
    const callId = asString(c.tool_call_id) ?? `devin-${stepId}-t${steps.length}`
    const name = asString(c.function_name) ?? 'tool'
    const input = asObject(c.arguments) ?? {}
    const s = stepFromToolUse({ id: callId, name, input })
    s.status = 'done'
    pending.set(callId, { name, input, step: s })
    steps.push(s)
    parts.push(s)
  }
  const observation = asObject(step.observation)
  for (const r of asArray(observation?.results)) {
    const res = asObject(r)
    if (!res) continue
    const callId = asString(res.source_call_id)
    const p = callId ? pending.get(callId) : undefined
    if (!callId || !p) continue
    const done = stepFromToolResult({
      toolUseId: callId,
      toolName: p.name,
      toolInput: p.input,
      content: asString(res.content) ?? '',
      isError: false,
    })
    Object.assign(p.step, done)
    p.step.status = 'done'
    pending.delete(callId)
  }

  if (!text && steps.length === 0) return undefined

  const msg: SessionMessage = {
    id: mintCliMessageId(),
    role: 'agent',
    text,
    at: ts ?? new Date().toISOString(),
    via: 'devin',
  }
  if (steps.length > 0) msg.steps = steps
  if (parts.length > 0) msg.parts = parts
  const metrics = asObject(step.metrics)
  if (metrics) {
    const inputTokens = asNumber(metrics.prompt_tokens) ?? 0
    const outputTokens = asNumber(metrics.completion_tokens) ?? 0
    const cacheReadTokens = asNumber(metrics.cached_tokens) ?? 0
    if (inputTokens + outputTokens + cacheReadTokens > 0) {
      msg.usage = {
        inputTokens,
        outputTokens,
        ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
      }
    }
  }
  const model = asString(step.model_name)
  if (model) msg.modelUsed = model
  return msg
}
