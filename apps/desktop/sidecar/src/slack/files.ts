// File đính kèm trong thread Slack: map metadata cho UI, thumbnail, tải về
// cache, lưu vào project, dọn cache cũ.
//
// URL tải (`url_private…`, `thumb_…`) KHÔNG BAO GIỜ đi ra renderer và cũng
// không nhận từ renderer: renderer chỉ gửi `teamId + fileId`, sidecar tự tra
// URL trong tin đã đọc (`rememberFiles`) hoặc hỏi `files.info`. Nếu nhận URL từ
// renderer thì một renderer bị chiếm có thể bắt sidecar mang token Slack đi
// gọi bất kỳ đâu.
//
// Cache: `~/.awog/slack/files/<teamId>/<fileId>/<tên đã làm sạch>`. Mỗi lần
// mở lại thì chạm mtime; file nào mtime quá 30 ngày thì `sweepSlackFileCache`
// xoá (chạy lúc khởi động engine).
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { copyFile, mkdir, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import { loadProject } from '../projects/store.js'
import { log } from '../util/logger.js'
import { SlackApiError } from './client.js'
import { cachedImageDataUri } from './avatar.js'
import { slackHome } from './json-file.js'
import { FILE_RE, TEAM_RE } from './params.js'
import { RawFileSchema, type RawFile } from './payload.js'
import type { SlackSession } from './session.js'
import type { SlackFile, SlackFileKind, SlackFileUnavailable } from './types.js'

export const FILE_MAX_BYTES = 200 * 1024 * 1024
export const FILE_CACHE_TTL_MS = 30 * 24 * 60 * 60_000
const THUMB_MAX_BYTES = 5 * 1024 * 1024
const PREVIEW_MAX_CHARS = 20_000
const NAME_MAX_CHARS = 120
// `.part` sót lại từ một lần tải bị ngắt (app tắt giữa chừng) — quá 1 ngày là rác.
const PART_TTL_MS = 24 * 60 * 60_000
// Đủ cho vài thread đang mở; bản cũ nhất bị đẩy ra, cần lại thì hỏi files.info.
const INDEX_MAX = 2000

const OFFICE_TYPES = new Set([
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  'gdoc',
  'gsheet',
  'gpres',
  'keynote',
  'numbers',
  'pages',
])
const TEXT_TYPES = new Set(['text', 'csv', 'tsv', 'json', 'markdown', 'xml', 'yaml', 'log'])

// ─── Chỉ mục file đã thấy trong tin ─────────────────────────────────────────

const index = new Map<string, RawFile>()

function indexKey(teamId: string, fileId: string): string {
  return `${teamId}:${fileId}`
}

export function rememberFiles(teamId: string, files: readonly RawFile[]): void {
  for (const f of files) {
    // File "check_file_info" chỉ có id — đừng đè bản đầy đủ đã biết.
    if (f.file_access === 'check_file_info' && index.has(indexKey(teamId, f.id))) continue
    index.delete(indexKey(teamId, f.id))
    index.set(indexKey(teamId, f.id), f)
  }
  while (index.size > INDEX_MAX) {
    const oldest = index.keys().next().value
    if (oldest === undefined) break
    index.delete(oldest)
  }
}

async function filesInfo(session: SlackSession, fileId: string): Promise<RawFile> {
  if (!session.hasScope('files:read')) {
    throw new SlackApiError('no_access', 'Slack token lacks files:read — reconnect the source')
  }
  try {
    const data = await session.api('files.info', { file: fileId })
    const parsed = RawFileSchema.safeParse(data.file)
    if (!parsed.success) throw new SlackApiError('bad_response', 'files.info returned no file')
    return parsed.data
  } catch (err) {
    if (err instanceof SlackApiError) {
      if (err.code === 'file_not_found' || err.code === 'file_deleted') {
        throw new SlackApiError('deleted', 'File was deleted on Slack')
      }
      if (err.code === 'missing_scope') {
        throw new SlackApiError('no_access', 'Slack token lacks files:read — reconnect the source')
      }
    }
    throw err
  }
}

async function resolveRawFile(session: SlackSession, fileId: string): Promise<RawFile> {
  const hit = index.get(indexKey(session.teamId, fileId))
  if (hit && hit.file_access !== 'check_file_info' && (hit.url_private || hit.thumb_360)) {
    return hit
  }
  const info = await filesInfo(session, fileId)
  rememberFiles(session.teamId, [info])
  return info
}

// File trong tin chỉ có `file_access: 'check_file_info'` (Slack Connect, file
// từ kênh khác) ⇒ hỏi files.info để có metadata. Thiếu scope thì thôi, để
// toSlackFile đánh dấu no_access.
export async function hydrateFiles(session: SlackSession, files: RawFile[]): Promise<RawFile[]> {
  if (!session.hasScope('files:read')) return files
  return Promise.all(
    files.map(async (f) => {
      if (f.file_access !== 'check_file_info') return f
      try {
        return await filesInfo(session, f.id)
      } catch {
        return f
      }
    }),
  )
}

// ─── Map cho UI ──────────────────────────────────────────────────────────────

export function fileKind(raw: RawFile): SlackFileKind {
  const mime = (raw.mimetype ?? '').toLowerCase()
  const type = (raw.filetype ?? '').toLowerCase()
  if (raw.mode === 'snippet' || raw.mode === 'post') return 'snippet'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf' || type === 'pdf') return 'pdf'
  if (
    OFFICE_TYPES.has(type) ||
    /officedocument|msword|ms-excel|ms-powerpoint|opendocument/.test(mime)
  ) {
    return 'office'
  }
  if (mime.startsWith('text/') || TEXT_TYPES.has(type)) return 'text'
  return 'other'
}

// File liên kết ngoài: Slack chỉ giữ metadata + link, `url_private` (nếu có) trỏ
// về dịch vụ khác hoặc proxy của Slack — không có gì để tải bằng token Slack.
function isExternalFile(raw: RawFile): boolean {
  return raw.is_external === true || raw.mode === 'external' || raw.filetype === 'remote'
}

function unavailableOf(raw: RawFile, canRead: boolean): SlackFileUnavailable | null {
  if (raw.mode === 'tombstone' || raw.file_access === 'file_not_found') return 'deleted'
  if (isExternalFile(raw)) return 'external'
  if (!canRead || raw.file_access === 'access_denied' || raw.file_access === 'check_file_info') {
    return 'no_access'
  }
  if ((raw.size ?? 0) > FILE_MAX_BYTES) return 'too_large'
  return null
}

function httpsUrlOrNull(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    return new URL(raw).protocol === 'https:' ? raw : null
  } catch {
    return null
  }
}

export function toSlackFile(raw: RawFile, canRead: boolean): SlackFile {
  const unavailable = unavailableOf(raw, canRead)
  // Thumbnail cũng nằm trên files.slack.com (cần files:read) ⇒ file không đọc
  // được thì đừng hứa thumbnail.
  const readable = unavailable === null || unavailable === 'too_large'
  let thumb: SlackFile['thumb'] = null
  if (readable && raw.thumb_720) {
    thumb = { size: 720, width: raw.thumb_720_w ?? 0, height: raw.thumb_720_h ?? 0 }
  } else if (readable && raw.thumb_360) {
    thumb = { size: 360, width: raw.thumb_360_w ?? 0, height: raw.thumb_360_h ?? 0 }
  }
  const previewRaw = raw.mode === 'post' ? (raw.plain_text ?? raw.preview) : raw.preview
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    title: raw.title ?? raw.name ?? '',
    mimetype: raw.mimetype ?? '',
    filetype: raw.filetype ?? '',
    size: raw.size ?? 0,
    kind: fileKind(raw),
    thumb,
    hasVideoPoster: readable && Boolean(raw.thumb_video),
    preview: readable && previewRaw ? previewRaw.slice(0, PREVIEW_MAX_CHARS) : null,
    permalink: raw.permalink ?? '',
    unavailable,
    // Chỉ `https:` — `javascript:`/`file:`… từ payload không bao giờ tới renderer.
    externalUrl: unavailable === 'external' ? httpsUrlOrNull(raw.external_url) : null,
  }
}

// ─── Đường dẫn cache ────────────────────────────────────────────────────────

function filesRoot(): string {
  return join(slackHome(), 'files')
}

function teamFilesDir(teamId: string): string {
  if (!TEAM_RE.test(teamId)) throw new Error('invalid team id')
  return join(filesRoot(), teamId)
}

function fileDir(teamId: string, fileId: string): string {
  if (!FILE_RE.test(fileId)) throw new Error('invalid file id')
  return join(teamFilesDir(teamId), fileId)
}

// Bỏ `/`, `\`, ký tự điều khiển và chuỗi `..`; cắt 120 ký tự nhưng giữ đuôi
// (đuôi quyết định app nào mở file). Tên rỗng sau khi làm sạch ⇒ dùng fileId.
export function sanitizeFileName(name: string, fallback = 'file'): string {
  let clean = name
    // eslint-disable-next-line no-control-regex -- cố ý lọc ký tự điều khiển
    .replace(/[\u0000-\u001f\u007f/\\:]/g, '_')
    .replace(/\.{2,}/g, '.')
    .trim()
  clean = clean.replace(/^[.\s]+/, '')
  if (!clean) clean = fallback
  if (clean.length > NAME_MAX_CHARS) {
    const ext = extname(clean).slice(0, 16)
    clean = `${clean.slice(0, NAME_MAX_CHARS - ext.length).trimEnd()}${ext}`
  }
  return clean
}

// ─── Thumbnail ──────────────────────────────────────────────────────────────

export async function fileThumb(
  session: SlackSession,
  fileId: string,
  size: 360 | 720,
): Promise<string> {
  const raw = await resolveRawFile(session, fileId)
  const unavailable = unavailableOf(raw, session.hasScope('files:read'))
  if (unavailable === 'deleted' || unavailable === 'no_access' || unavailable === 'external') {
    throw new SlackApiError(unavailable, `File is ${unavailable}`)
  }
  const url =
    size === 720
      ? (raw.thumb_720 ?? raw.thumb_360 ?? raw.thumb_video)
      : (raw.thumb_360 ?? raw.thumb_720 ?? raw.thumb_video)
  if (!url) throw new SlackApiError('no_thumbnail', 'File has no thumbnail')
  const base = join(teamFilesDir(session.teamId), 'thumbs', `${fileId}-${size}`)
  const dataUrl = await cachedImageDataUri(session, url, base, THUMB_MAX_BYTES)
  if (!dataUrl) throw new SlackApiError('no_thumbnail', 'Thumbnail could not be downloaded')
  return dataUrl
}

// ─── Tải file gốc ───────────────────────────────────────────────────────────

export type FetchedFile = { path: string; name: string; mimetype: string }

const downloads = new Map<string, Promise<FetchedFile>>()

async function existingSize(path: string): Promise<number | null> {
  try {
    const st = await stat(path)
    return st.isFile() ? st.size : null
  } catch {
    return null
  }
}

const execFileAsync = promisify(execFile)

// Cờ quarantine của macOS: `0081` = tải về, chưa được người dùng duyệt;
// timestamp là epoch giây dạng hex; agent hiện trong hộp thoại Gatekeeper.
function quarantineValue(nowMs: number): string {
  return `0081;${Math.floor(nowMs / 1000).toString(16)};AWOG;`
}

const ZONE_IDENTIFIER = '[ZoneTransfer]\r\nZoneId=3\r\n'

// Gắn cờ "tải từ Internet" lên file vừa tải từ Slack. File do NGƯỜI NGOÀI gửi
// (khách, bot) — mở bằng app mặc định mà không có cờ thì Gatekeeper (macOS) /
// SmartScreen + Protected View (Windows) bỏ qua bước cảnh báo mà trình duyệt
// vẫn làm. Linux không có cơ chế tương đương ⇒ bỏ qua. Lỗi chỉ log: thiếu cờ
// không được làm hỏng việc tải.
export async function markDownloadedFromInternet(path: string): Promise<void> {
  try {
    if (process.platform === 'darwin') {
      // Mảng tham số, không shell: `path` có thể chứa ký tự lạ từ tên file Slack.
      await execFileAsync('xattr', ['-w', 'com.apple.quarantine', quarantineValue(Date.now()), path])
    } else if (process.platform === 'win32') {
      await writeFile(`${path}:Zone.Identifier`, ZONE_IDENTIFIER, 'utf8')
    }
  } catch (err) {
    log.warn('slack: failed to mark file as downloaded from the Internet', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

async function touch(path: string): Promise<void> {
  const now = new Date()
  await utimes(path, now, now).catch(() => undefined)
}

async function doFetch(session: SlackSession, fileId: string): Promise<FetchedFile> {
  const raw = await resolveRawFile(session, fileId)
  const unavailable = unavailableOf(raw, session.hasScope('files:read'))
  if (unavailable) throw new SlackApiError(unavailable, `File is ${unavailable}`)
  const url = raw.url_private_download ?? raw.url_private
  if (!url) throw new SlackApiError('no_access', 'File has no download URL')
  const name = sanitizeFileName(raw.name ?? raw.title ?? '', fileId)
  const dir = fileDir(session.teamId, fileId)
  const target = join(dir, name)
  const mimetype = raw.mimetype ?? 'application/octet-stream'

  const have = await existingSize(target)
  if (have !== null && (raw.size === undefined || have === raw.size)) {
    await touch(target)
    return { path: target, name, mimetype }
  }
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const part = `${target}.part`
  await session.download(url, part, FILE_MAX_BYTES)
  await rename(part, target)
  await markDownloadedFromInternet(target)
  return { path: target, name, mimetype }
}

export function fetchFile(session: SlackSession, fileId: string): Promise<FetchedFile> {
  const key = indexKey(session.teamId, fileId)
  const running = downloads.get(key)
  if (running) return running
  const task = doFetch(session, fileId).finally(() => downloads.delete(key))
  downloads.set(key, task)
  return task
}

// ─── Lưu vào project ────────────────────────────────────────────────────────

const MAX_NAME_ATTEMPTS = 100

function numbered(name: string, n: number): string {
  if (n === 0) return name
  const ext = extname(name)
  return `${name.slice(0, name.length - ext.length)} (${n})${ext}`
}

// Tên file mà agent (Claude Code, Codex, Gemini, Cursor, Cline, Copilot) tự nạp làm CHỈ
// DẪN khi nằm ở gốc project — so không phân biệt hoa thường (macOS/Windows mặc định
// không phân biệt). Cộng mọi tên bắt đầu `.` (`.mcp.json`, `.env`, `.cursorrules`…):
// file cấu hình/ẩn ở gốc project không bao giờ nên đến từ một người ngoài trên Slack.
const AGENT_INSTRUCTION_NAMES = new Set([
  'claude.md',
  'claude.local.md',
  'agents.md',
  'gemini.md',
  '.cursorrules',
  '.clinerules',
  'copilot-instructions.md',
])
const SAFE_PREFIX = 'slack-'

// File người ngoài gửi lên Slack mà đáp xuống gốc project với tên `CLAUDE.md` thì phiên
// AI kế tiếp của project nạp nó như chỉ dẫn của chính người dùng — prompt injection
// bền, không cần ai mở file. Thêm tiền tố `slack-` để nó chỉ còn là một file dữ liệu.
export function projectSafeFileName(name: string): string {
  const lower = name.toLowerCase()
  return AGENT_INSTRUCTION_NAMES.has(lower) || name.startsWith('.') ? `${SAFE_PREFIX}${name}` : name
}

// Lưu vào GỐC project (UI không có chọn thư mục con nên không nhận đường dẫn
// tương đối từ renderer — bớt một input L1 đi vào filesystem). Không đè file
// người dùng đã có: trùng tên thì đánh số `tên (1).ext`. Tên trùng file chỉ dẫn
// agent thì thêm tiền tố (projectSafeFileName).
export async function saveFileToProject(
  session: SlackSession,
  fileId: string,
  projectId: string,
): Promise<{ path: string }> {
  const project = await loadProject(projectId)
  if (!project) throw new SlackApiError('project_not_found', 'Project not found')
  if (!isAbsolute(project.path)) throw new SlackApiError('project_not_found', 'Project has no path')
  const fetched = await fetchFile(session, fileId)
  const baseName = projectSafeFileName(fetched.name)
  for (let n = 0; n < MAX_NAME_ATTEMPTS; n += 1) {
    // Tên đã qua sanitizeFileName, vẫn đi qua assertInsideWorkspace (invariant #2).
    const dest = assertInsideWorkspace(project.path, numbered(baseName, n))
    try {
      // eslint-disable-next-line no-await-in-loop -- thử tên kế tiếp chỉ khi tên này đã có
      await copyFile(fetched.path, dest, constants.COPYFILE_EXCL)
      // Bản chép không chắc mang theo xattr/ADS của bản cache ⇒ gắn lại cờ.
      // eslint-disable-next-line no-await-in-loop
      await markDownloadedFromInternet(dest)
      return { path: dest }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new SlackApiError('name_conflict', 'Too many files with the same name')
}

// ─── Dọn cache ──────────────────────────────────────────────────────────────

async function newestMtime(dir: string): Promise<number> {
  let newest = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    // eslint-disable-next-line no-await-in-loop -- vài file mỗi thư mục
    const st = await stat(join(dir, entry.name)).catch(() => null)
    if (st && st.mtimeMs > newest) newest = st.mtimeMs
  }
  return newest
}

async function sweepPlainFiles(dir: string, cutoff: number): Promise<number> {
  let removed = 0
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile()) continue
    const path = join(dir, entry.name)
    // eslint-disable-next-line no-await-in-loop
    const st = await stat(path).catch(() => null)
    if (st && st.mtimeMs < cutoff) {
      // eslint-disable-next-line no-await-in-loop
      await rm(path, { force: true })
      removed += 1
    }
  }
  return removed
}

// Xoá file gốc + thumbnail không mở quá 30 ngày, và `.part` bỏ dở. Không bao
// giờ ném: dọn cache hỏng không được làm hỏng lúc khởi động engine.
export async function sweepSlackFileCache(now: number = Date.now()): Promise<number> {
  const cutoff = now - FILE_CACHE_TTL_MS
  const partCutoff = now - PART_TTL_MS
  let removed = 0
  try {
    for (const team of await readdir(filesRoot(), { withFileTypes: true }).catch(() => [])) {
      if (!team.isDirectory() || !TEAM_RE.test(team.name)) continue
      const teamDir = join(filesRoot(), team.name)
      // eslint-disable-next-line no-await-in-loop
      for (const entry of await readdir(teamDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const dir = join(teamDir, entry.name)
        if (entry.name === 'thumbs') {
          // eslint-disable-next-line no-await-in-loop
          removed += await sweepPlainFiles(dir, cutoff)
          continue
        }
        if (!FILE_RE.test(entry.name)) continue
        // eslint-disable-next-line no-await-in-loop
        const newest = await newestMtime(dir)
        // Chỉ còn `.part` (mtime mới) nhưng quá hạn bỏ dở ⇒ cũng dọn.
        const onlyParts = (await readdir(dir)).every((n) => n.endsWith('.part'))
        if (newest < cutoff || (onlyParts && newest < partCutoff)) {
          // eslint-disable-next-line no-await-in-loop
          await rm(dir, { recursive: true, force: true })
          removed += 1
        }
      }
    }
  } catch (err) {
    log.warn('slack: file cache sweep failed', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
  if (removed > 0) log.info('slack: swept file cache', { removed })
  return removed
}
