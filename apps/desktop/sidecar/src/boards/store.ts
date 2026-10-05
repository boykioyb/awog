// Board work-item — backlog THEO PROJECT của Session Teams
// (docs/features/session-teams.md §1.2). Mỗi project một file
// `~/.awog/boards/<projectId>.json` dạng `{version:1, items:[BoardItem]}`.
//
// Board là của PROJECT, không phải của GROUP: nhiều nhóm trong cùng project
// nhìn chung một backlog, và xoá nhóm không mất việc. Vì vậy file nằm theo
// projectId chứ không theo runId (channel thì ngược lại — chết theo nhóm).
//
// Hợp đồng status: agent tự ghi qua tool `team_item_update` TRỪ `done`/
// `cancelled` (của người dùng — merge là click UI). Hệ thống tự sửa đúng hai chỗ:
// lượt của assignee FAIL → `rollbackInProgressItems` đưa in_progress về todo;
// merge thành công → caller của sessions.integrateMember upsert `done` +
// `mergedBranch`. Tất cả đều tụ về đây nên trần/chuẩn hoá/redact chỉ viết một lần.
//
// Ghi = đọc-sửa-ghi nguyên file dưới một mutex per projectId (chuỗi promise):
// sidecar một tiến trình nhưng hai tool call `await` xen nhau được, và board là
// điểm gặp của MỌI member trong ê-kíp — không có khoá, hai member cùng upsert sẽ
// mất một nửa. Ghi nguyên tử qua `.tmp` + rename + chmod 600 như mọi store khác.
// Đọc không cần khoá: rename là atomic nên người đọc chỉ thấy bản cũ hoặc mới.

import { mkdir, readFile, writeFile, chmod, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { awogHome, sanitizeChild } from '../util/path.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { redactString } from '../sessions/redact.js'
import { MESSAGE_ID_RE } from '../sessions/ids.js'
import type {
  BoardItem,
  BoardItemComment,
  BoardItemPriority,
  BoardItemSeverity,
  BoardItemStatus,
  BoardItemType,
  ProjectBoard,
  SessionLlmOverride,
} from '../types/shared.js'

const BOARDS_DIR_NAME = sanitizeChild('boards')

// Trần của spec §1.2. Title là NHÃN → làm phẳng một dòng + cắt có dấu '…' (cùng
// triết lý oneLineLabel của hộp thư); desc/comment là NỘI DUNG → TỪ CHỐI khi quá
// trần để bên gọi biết mà viết lại ngắn hơn, thay vì âm thầm mất đuôi.
export const MAX_BOARD_ITEMS = 500
export const MAX_ITEM_TITLE_LEN = 140
export const MAX_ITEM_DESC_LEN = 8000
export const MAX_COMMENT_LEN = 4000
export const MAX_COMMENTS_PER_ITEM = 100

// Thứ tự hiển thị board — đúng thứ tự pipeline: backlog và todo (việc đã xếp,
// chờ bốc) lên đầu, các trạng thái sống giữa, done/cancelled ở đuôi. Export để
// `boards.list` và mọi bề mặt khác (tool list, UI columns) dùng chung một thứ
// tự thay vì tự nghĩ lại — giữ đồng bộ với stores/board.ts bên UI.
export const BOARD_STATUS_ORDER: readonly BoardItemStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'changes',
  'blocked',
  'done',
  'cancelled',
]

const STATUS_SET: ReadonlySet<string> = new Set(BOARD_STATUS_ORDER)

export type BoardErrorCode =
  | 'invalid-input' // title rỗng / id lạ / status ngoài enum / vượt trần độ dài
  | 'unknown-item' // update/comment/xoá một item không tồn tại
  | 'board-full' // chạm MAX_BOARD_ITEMS
  | 'comments-full' // chạm MAX_COMMENTS_PER_ITEM

// Từ chối CÓ LÝ DO — cùng khuôn InboxError/SpawnError: tool trả nguyên `message`
// cho model, RPC bọc thành RpcError cho UI.
export class BoardError extends Error {
  public readonly code: BoardErrorCode

  constructor(code: BoardErrorCode, message: string) {
    super(message)
    this.name = 'BoardError'
    this.code = code
  }
}

function boardsDir(): string {
  return join(awogHome(), BOARDS_DIR_NAME)
}

function boardFile(projectId: string): string {
  return join(boardsDir(), `${sanitizeChild(projectId)}.json`)
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

// Ký tự điều khiển C0/C1 (kể cả xuống dòng): title là một dòng phẳng.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]+/g

// Label một dòng có trần — bản địa của `oneLineLabel` trong sessions/inbox.ts.
// Không import chéo: inbox kéo theo cả runner cho một hàm 4 dòng là quá nặng cho
// một module storage.
function oneLine(raw: string, max: number): string {
  const flat = raw.replace(CONTROL_RE, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max - 1)}…`
}

// Id AWOG tự mint, khớp MESSAGE_ID_RE (`bi-<hex>` cho item, `bc-<hex>` cho
// comment) — nằm trong JSON chứ không vào đường dẫn, nhưng charset hẹp giữ file
// đọc/ghi tay được an toàn và nhất quán với mọi id khác.
function mintItemId(): string {
  return `bi-${randomBytes(8).toString('hex')}`
}

function mintCommentId(): string {
  return `bc-${randomBytes(6).toString('hex')}`
}

// ─── Chuẩn hoá + redact ─────────────────────────────────────────────────────
// Mọi chuỗi đi vào file đều có thể do MODEL viết (tool team_item_*) hoặc do
// người dùng gõ (RPC) — và nội dung board sẽ quay lại context của mọi member
// khác qua <team>/team_item_list. Khử bí mật TẠI ĐÂY một lần thay vì tin từng
// điểm gọi nhớ làm.

function cleanTitle(raw: string): string {
  return oneLine(redactString(raw), MAX_ITEM_TITLE_LEN)
}

function cleanDesc(raw: string): string {
  const out = redactString(raw)
  if (out.length > MAX_ITEM_DESC_LEN) {
    throw new BoardError(
      'invalid-input',
      `Description is ${out.length} characters; the limit is ${MAX_ITEM_DESC_LEN}. Shorten it or split the item.`,
    )
  }
  return out
}

function cleanCommentText(raw: string): string {
  const out = redactString(raw).trim()
  if (!out) throw new BoardError('invalid-input', 'Comment is empty; nothing was added.')
  if (out.length > MAX_COMMENT_LEN) {
    throw new BoardError(
      'invalid-input',
      `Comment is ${out.length} characters; the limit is ${MAX_COMMENT_LEN}.`,
    )
  }
  return out
}

function cleanStatus(raw: string): BoardItemStatus {
  if (!STATUS_SET.has(raw)) {
    throw new BoardError('invalid-input', `Unknown board status "${raw}".`)
  }
  return raw as BoardItemStatus
}

function cleanStage(raw: number): number {
  // Stage là số đợt (wave): phải nguyên ≥ 0 — một giá trị kỳ dị (NaN, âm, thập
  // phân) phá luôn phép so sánh "stage thấp nhất" của checkStageWave.
  if (!Number.isInteger(raw) || raw < 0) {
    throw new BoardError('invalid-input', `Stage must be a non-negative integer, got ${raw}.`)
  }
  return raw
}

function cleanItemId(raw: string): string {
  if (!MESSAGE_ID_RE.test(raw)) {
    throw new BoardError('invalid-input', `Illegal board item id "${raw}".`)
  }
  return raw
}

const TYPE_SET: ReadonlySet<string> = new Set(['epic', 'story', 'task', 'subtask', 'bug'])
const PRIORITY_SET: ReadonlySet<string> = new Set(['urgent', 'high', 'medium', 'low'])
const SEVERITY_SET: ReadonlySet<string> = new Set(['blocker', 'major', 'minor', 'trivial'])

function cleanEnum(raw: string, allowed: ReadonlySet<string>, field: string): string {
  if (!allowed.has(raw)) {
    throw new BoardError('invalid-input', `Unknown ${field} "${raw}".`)
  }
  return raw
}

const cleanType = (raw: string): BoardItemType =>
  cleanEnum(raw, TYPE_SET, 'issue type') as BoardItemType
const cleanPriority = (raw: string): BoardItemPriority =>
  cleanEnum(raw, PRIORITY_SET, 'priority') as BoardItemPriority
const cleanSeverity = (raw: string): BoardItemSeverity =>
  cleanEnum(raw, SEVERITY_SET, 'severity') as BoardItemSeverity

// Kiểm một `parentId` đặt cho `itemId` trong `items`: cha phải tồn tại, không
// tự trỏ về mình, và đi lên chuỗi cha từ cha dự kiến không được gặp lại chính
// item (vòng). null/undefined ⇒ không kiểm (gỡ cha).
export function checkParentLink(
  items: readonly BoardItem[],
  itemId: string | null,
  parentId: string,
): string {
  const pid = cleanItemId(parentId)
  if (pid === itemId) {
    throw new BoardError('invalid-input', 'An item cannot be its own parent.')
  }
  if (!items.some((i) => i.id === pid)) {
    throw new BoardError('unknown-item', `No board item "${pid}" to use as parent.`)
  }
  // Leo lên chuỗi cha từ cha dự kiến: gặp lại itemId ⇒ vòng. Trần lặp chống
  // dữ liệu hỏng có sẵn (vòng trên đĩa từ bug cũ) làm treo vòng lặp.
  let cursor: string | undefined = pid
  for (let depth = 0; depth <= items.length && cursor; depth++) {
    if (cursor === itemId) {
      throw new BoardError(
        'invalid-input',
        `Making "${pid}" a parent of "${itemId}" would create a cycle.`,
      )
    }
    cursor = items.find((i) => i.id === cursor)?.parentId
  }
  return pid
}

// Key hợp lệ của assigneeConfig: 'self' | 'lead' | 'member:<title>' — title
// mang theo để map vào member spec lúc materialize lười.
const ASSIGNEE_CFG_KEY_RE = /^(self|lead|member:[^|]{1,120})$/
const PROVIDER_SET: ReadonlySet<string> = new Set(['anthropic', 'openai', 'google'])
const LEVEL_SET: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'extra-high', 'max'])
const MODE_SET: ReadonlySet<string> = new Set(['ask', 'accept-edits', 'plan', 'execute'])

// Sanitize map override LLM per-slot. Chặt ở đây thay vì tin từng điểm đọc vì
// record board là trusted boundary — một key/value bẩn vào file là nó rỏ vào
// settings của mọi phiên được materialize từ item đó. Entry rỗng (không field
// nào có nghĩa) bị bỏ; key lạ / provider ngoài enum → lỗi rõ ràng thay vì câm.
function cleanAssigneeConfig(
  raw: Record<string, SessionLlmOverride>,
): Record<string, SessionLlmOverride> {
  const out: Record<string, SessionLlmOverride> = {}
  for (const [key, ov] of Object.entries(raw)) {
    if (!ASSIGNEE_CFG_KEY_RE.test(key)) {
      throw new BoardError('invalid-input', `Illegal assigneeConfig key "${key}".`)
    }
    if (typeof ov !== 'object' || ov === null) continue
    const entry: SessionLlmOverride = {}
    if (ov.provider !== undefined) {
      if (!PROVIDER_SET.has(ov.provider)) {
        throw new BoardError('invalid-input', `Unknown provider "${ov.provider}" in assigneeConfig.`)
      }
      entry.provider = ov.provider
    }
    if (ov.modelId !== undefined) entry.modelId = oneLine(ov.modelId, 200)
    if (ov.accountId !== undefined) entry.accountId = oneLine(ov.accountId, 64)
    if (ov.level !== undefined) {
      if (!LEVEL_SET.has(ov.level)) {
        throw new BoardError('invalid-input', `Unknown thinking level "${ov.level}" in assigneeConfig.`)
      }
      entry.level = ov.level
    }
    if (ov.mode !== undefined) {
      if (!MODE_SET.has(ov.mode)) {
        throw new BoardError('invalid-input', `Unknown agent mode "${ov.mode}" in assigneeConfig.`)
      }
      entry.mode = ov.mode
    }
    if (Object.keys(entry).length) out[key] = entry
  }
  return out
}

// ─── Đọc / ghi file ─────────────────────────────────────────────────────────

// Hàng đợi ghi nối tiếp theo projectId. Một nhịp hỏng KHÔNG được làm kẹt cả hàng
// (catch(() => {}) trước khi nối), và entry được gỡ khi hàng rỗng để map không
// phình theo số project từng đụng tới.
const writeQueues = new Map<string, Promise<unknown>>()

function withBoardLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(projectId) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(fn)
  writeQueues.set(projectId, next)
  // Dọn entry khi hàng rỗng. Phải là `.then(cleanup, cleanup)` — KHÔNG phải
  // `.finally(cleanup)`: finally ném-lại rejection của `next` vào một promise con
  // không ai hứng → unhandled rejection mỗi lần một ghi bị từ chối.
  const cleanup = () => {
    if (writeQueues.get(projectId) === next) writeQueues.delete(projectId)
  }
  void next.then(cleanup, cleanup)
  return next
}

// Lọc mềm khi đọc: file nằm trong ~/.awog — người dùng sửa tay được. Một entry
// hỏng hình hoặc mang projectId khác (file lỡ bị ghi nhầm) bị BỎ QUA chứ không
// làm sập cả board — cùng luật "bản ghi xấu bị skip" của session-manager.
function sanitizeItems(raw: unknown, projectId: string, file: string): BoardItem[] {
  if (!Array.isArray(raw)) return []
  const out: BoardItem[] = []
  let dropped = 0
  for (const entry of raw) {
    const it = entry as Partial<BoardItem> | null
    if (
      !it ||
      typeof it !== 'object' ||
      typeof it.id !== 'string' ||
      typeof it.title !== 'string' ||
      it.projectId !== projectId ||
      typeof it.status !== 'string' ||
      !STATUS_SET.has(it.status) ||
      !Array.isArray(it.comments)
    ) {
      dropped += 1
      continue
    }
    out.push(it as BoardItem)
  }
  // Field mới (type/priority/severity/parentId) cũng do tay sửa được — giá trị
  // lạ chỉ làm nhiễu UI nên gỡ nhẹ thay vì bỏ cả item. parentId trỏ hụt (cha
  // đã xoá bằng tay, hoặc file gộp) cũng bị gỡ.
  const ids = new Set(out.map((i) => i.id))
  for (const it of out) {
    if (it.type !== undefined && !TYPE_SET.has(it.type)) delete it.type
    if (it.priority !== undefined && !PRIORITY_SET.has(it.priority)) delete it.priority
    if (it.severity !== undefined && !SEVERITY_SET.has(it.severity)) delete it.severity
    if (it.parentId !== undefined && (it.parentId === it.id || !ids.has(it.parentId))) {
      delete it.parentId
    }
  }
  if (dropped > 0) {
    log.warn('boards: dropped malformed/foreign items on load', { file, dropped })
  }
  return out
}

// Board rỗng khi file chưa có. File có mà KHÔNG đọc được (JSON hỏng) → trả rỗng
// + warn: giống workflows/projects store — board không thể vì một file hỏng mà
// khước từ mọi RPC. Đường ghi qua `quarantineCorruptBoard` cách ly file hỏng đó
// trước khi viết đè, nên dữ liệu cũ không mất dấu.
async function loadBoard(projectId: string): Promise<ProjectBoard> {
  const file = boardFile(projectId)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    if (isMissing(err)) return { version: 1, items: [] }
    throw err
  }
  try {
    const obj = JSON.parse(raw) as Partial<ProjectBoard> | null
    if (!obj || typeof obj !== 'object' || obj.version !== 1) {
      throw new Error('not a v1 board')
    }
    return { version: 1, items: sanitizeItems(obj.items, projectId, file) }
  } catch (err) {
    log.warn('boards: failed to parse, treating as empty', {
      file,
      err: err instanceof Error ? err.message : String(err),
    })
    return { version: 1, items: [] }
  }
}

async function saveBoard(projectId: string, board: ProjectBoard): Promise<void> {
  const dir = boardsDir()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = boardFile(projectId)
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(board, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

// Board là dữ liệu làm việc của user: nếu file đang có mà JSON hỏng thì đổi tên
// sang `<file>.corrupt-<ts>` trước khi ghi bản mới — mất backlog vì một lần sửa
// tay hỏng là điều không cứu được, còn một file `.corrupt` thì đọc lại được.
async function quarantineCorruptBoard(projectId: string): Promise<void> {
  const file = boardFile(projectId)
  try {
    const raw = await readFile(file, 'utf8')
    try {
      const obj = JSON.parse(raw) as Partial<ProjectBoard> | null
      if (obj && typeof obj === 'object' && obj.version === 1) return
    } catch {
      // fall through — file không parse được.
    }
    const aside = `${file}.corrupt-${Date.now()}`
    await rename(file, aside)
    log.warn('boards: quarantined unparsable board file', { file, aside })
  } catch (err) {
    if (isMissing(err)) return
    throw err
  }
}

// Phát cho renderer refetch board (spec §7). Đặt ngay cạnh saveBoard để mọi đột
// biến — tool, RPC, rollback — đều báo một giọng.
function emitBoardChanged(projectId: string): void {
  emit('board.changed', { projectId })
}

// ─── API công khai ──────────────────────────────────────────────────────────

export async function listBoardItems(projectId: string): Promise<BoardItem[]> {
  const board = await loadBoard(projectId)
  return board.items
}

export async function getBoardItem(
  projectId: string,
  itemId: string,
): Promise<BoardItem | null> {
  const board = await loadBoard(projectId)
  return board.items.find((i) => i.id === itemId) ?? null
}

export interface UpsertBoardItemInput {
  // Có `id` = update; không có = tạo mới.
  // (`| undefined` tường minh vì exactOptionalPropertyTypes: caller được gán key
  // mang giá trị undefined — zod `.optional()` và TypeBox `Type.Optional` đều
  // sinh ra kiểu đó.)
  id?: string | undefined
  title?: string | undefined
  desc?: string | undefined
  // null = gỡ assignee (chỉ có nghĩa khi update; khi tạo thì "không giao").
  assigneeSessionId?: string | null | undefined
  // Spec người nhận dự kiến ('agent:<key>'/'team:<key>') — xem BoardItem.
  // null = gỡ ref (sau khi materialize, hoặc user đổi sang giao cho phiên sống).
  assigneeRef?: string | null | undefined
  // Override LLM per-slot (BoardItem.assigneeConfig). null = xoá hẳn cả map.
  assigneeConfig?: Record<string, SessionLlmOverride> | null | undefined
  status?: BoardItemStatus | undefined
  // Loại việc (khuôn Jira) + cây cha-con + ưu tiên/mức độ. parentId: null =
  // gỡ khỏi cha (thành item cấp trên); priority/severity null = gỡ nhãn
  // (về "không đặt"); type không nhận null — luôn có một loại.
  type?: string | undefined
  parentId?: string | null | undefined
  priority?: string | null | undefined
  severity?: string | null | undefined
  // null = gỡ stage (item không còn thuộc đợt nào).
  stage?: number | null | undefined
  // Chỉ áp lúc TẠO: sessionId của bên tạo, null = người dùng. Update không được
  // viết lại provenance — đó là lịch sử, không phải field hiện tại.
  createdBy?: string | null | undefined
  // Branch member đã merge — chỉ sessions.integrateMember ghi (đường done của
  // user). null/undefined không đụng tới field.
  mergedBranch?: string | null | undefined
}

export async function upsertBoardItem(
  projectId: string,
  input: UpsertBoardItemInput,
): Promise<BoardItem> {
  return withBoardLock(projectId, async () => {
    await quarantineCorruptBoard(projectId)
    const board = await loadBoard(projectId)
    const now = new Date().toISOString()

    if (input.id !== undefined) {
      // ── Update ──
      const id = cleanItemId(input.id)
      const item = board.items.find((i) => i.id === id)
      if (!item) {
        throw new BoardError('unknown-item', `No board item "${id}" in project "${projectId}".`)
      }
      if (input.title !== undefined) {
        const title = cleanTitle(input.title)
        if (!title) throw new BoardError('invalid-input', 'Title cannot be empty.')
        item.title = title
      }
      if (input.desc !== undefined) {
        const desc = cleanDesc(input.desc)
        // '' = xoá desc (form UI gửi chuỗi rỗng khi user xoá trắng ô).
        if (desc === '') delete item.desc
        else item.desc = desc
      }
      if (input.assigneeSessionId !== undefined) {
        if (input.assigneeSessionId === null) delete item.assigneeSessionId
        else item.assigneeSessionId = input.assigneeSessionId
      }
      if (input.assigneeRef !== undefined) {
        if (input.assigneeRef === null) delete item.assigneeRef
        else item.assigneeRef = oneLine(input.assigneeRef, 200)
      }
      if (input.assigneeConfig !== undefined) {
        if (input.assigneeConfig === null) delete item.assigneeConfig
        else item.assigneeConfig = cleanAssigneeConfig(input.assigneeConfig)
      }
      if (input.status !== undefined) item.status = cleanStatus(input.status)
      if (input.type !== undefined) item.type = cleanType(input.type)
      if (input.priority !== undefined) {
        if (input.priority === null) delete item.priority
        else item.priority = cleanPriority(input.priority)
      }
      if (input.severity !== undefined) {
        if (input.severity === null) delete item.severity
        else item.severity = cleanSeverity(input.severity)
      }
      if (input.parentId !== undefined) {
        if (input.parentId === null) delete item.parentId
        else item.parentId = checkParentLink(board.items, item.id, input.parentId)
      }
      if (input.stage !== undefined) {
        if (input.stage === null) delete item.stage
        else item.stage = cleanStage(input.stage)
      }
      if (input.mergedBranch !== undefined && input.mergedBranch !== null) {
        item.mergedBranch = oneLine(redactString(input.mergedBranch), 200)
      }
      item.updatedAt = now
      await saveBoard(projectId, board)
      emitBoardChanged(projectId)
      return item
    }

    // ── Create ──
    if (board.items.length >= MAX_BOARD_ITEMS) {
      throw new BoardError(
        'board-full',
        `The board already has ${MAX_BOARD_ITEMS} items — archive or delete some before adding more.`,
      )
    }
    if (input.title === undefined) {
      throw new BoardError('invalid-input', 'A new board item needs a title.')
    }
    const title = cleanTitle(input.title)
    if (!title) throw new BoardError('invalid-input', 'Title cannot be empty.')
    const item: BoardItem = {
      id: mintItemId(),
      projectId,
      title,
      status: input.status !== undefined ? cleanStatus(input.status) : 'todo',
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
      comments: [],
    }
    if (input.desc !== undefined && input.desc !== '') item.desc = cleanDesc(input.desc)
    if (input.type !== undefined) item.type = cleanType(input.type)
    if (input.priority !== undefined && input.priority !== null) {
      item.priority = cleanPriority(input.priority)
    }
    if (input.severity !== undefined && input.severity !== null) {
      item.severity = cleanSeverity(input.severity)
    }
    if (input.parentId !== undefined && input.parentId !== null) {
      item.parentId = checkParentLink(board.items, item.id, input.parentId)
    }
    if (input.assigneeSessionId) item.assigneeSessionId = input.assigneeSessionId
    if (input.assigneeRef) item.assigneeRef = oneLine(input.assigneeRef, 200)
    if (input.assigneeConfig) item.assigneeConfig = cleanAssigneeConfig(input.assigneeConfig)
    if (input.stage !== undefined && input.stage !== null) item.stage = cleanStage(input.stage)
    board.items.push(item)
    await saveBoard(projectId, board)
    emitBoardChanged(projectId)
    return item
  })
}

// Trả về item vừa xoá (null = không thấy) để caller cascade theo
// assigneeSessionId — phiên được giao việc chết theo item (session-teams §7).
export async function deleteBoardItem(
  projectId: string,
  itemId: string,
): Promise<BoardItem | null> {
  return withBoardLock(projectId, async () => {
    const board = await loadBoard(projectId)
    const idx = board.items.findIndex((i) => i.id === itemId)
    if (idx < 0) return null
    const [item] = board.items.splice(idx, 1)
    // Con của item vừa xoá mất liên kết cha (mồ côi) chứ không chết theo —
    // xoá cả nhánh là hành vi khó đoán nên board giữ con, chỉ gỡ parentId.
    for (const child of board.items) {
      if (child.parentId === itemId) {
        delete child.parentId
        child.updatedAt = new Date().toISOString()
      }
    }
    await saveBoard(projectId, board)
    emitBoardChanged(projectId)
    return item
  })
}

export async function addBoardItemComment(
  projectId: string,
  itemId: string,
  input: { from: string | null; fromTitle: string; text: string },
): Promise<BoardItemComment | null> {
  return withBoardLock(projectId, async () => {
    const board = await loadBoard(projectId)
    const item = board.items.find((i) => i.id === itemId)
    if (!item) return null
    if (item.comments.length >= MAX_COMMENTS_PER_ITEM) {
      throw new BoardError(
        'comments-full',
        `Item "${item.id}" already has ${MAX_COMMENTS_PER_ITEM} comments — that is the cap.`,
      )
    }
    const comment: BoardItemComment = {
      id: mintCommentId(),
      at: new Date().toISOString(),
      from: input.from,
      // fromTitle là nhãn do người dùng/model viết → cùng đường redact + một dòng.
      fromTitle: oneLine(redactString(input.fromTitle), MAX_ITEM_TITLE_LEN) || 'unknown',
      text: cleanCommentText(input.text),
    }
    item.comments.push(comment)
    item.updatedAt = comment.at
    await saveBoard(projectId, board)
    emitBoardChanged(projectId)
    return comment
  })
}

// Lượt của `sessionId` fail (stopReason error/cancel) → mọi item đang
// `in_progress` do nó phụ trách về `todo` + một system comment giải thích —
// spec §1.2: fail của LƯỢT là một trong hai chỗ hệ thống tự sửa status (chỗ kia
// là merge thành công). `blocked` KHÔNG bị cuốn — đó là member TỰ báo kẹt, một
// trạng thái có chủ đích, không phải crash. Gọi từ đường lỗi của
// sessions.send-message. Trả số item đã rollback.
export async function rollbackInProgressItems(
  projectId: string,
  sessionId: string,
): Promise<number> {
  return withBoardLock(projectId, async () => {
    const board = await loadBoard(projectId)
    const now = new Date().toISOString()
    let count = 0
    for (const item of board.items) {
      if (item.status !== 'in_progress' || item.assigneeSessionId !== sessionId) continue
      item.status = 'todo'
      item.updatedAt = now
      if (item.comments.length < MAX_COMMENTS_PER_ITEM) {
        item.comments.push({
          id: mintCommentId(),
          at: now,
          // Comment hệ thống: from=null + fromTitle 'system' — cùng quy ước với
          // TeamChannelEntry kind 'system' (không phải user, không phải phiên).
          from: null,
          fromTitle: 'system',
          text: 'Turn failed; returned to todo',
        })
      }
      count += 1
    }
    if (count > 0) {
      await saveBoard(projectId, board)
      emitBoardChanged(projectId)
    }
    return count
  })
}

// Stage đã được THÔNG BÁO per project — checkStageWave được gọi sau MỌI đổi
// status (spec §5) nên không có map này thì "stage 1 complete" sẽ được post lại
// sau từng update cho tới khi stage 1 biến mất khỏi board. In-memory là đủ:
// mất khi restart chỉ có nghĩa thông báo nhắc lại đúng một lần.
const announcedWaves = new Map<string, Set<number>>()

// Kiểm tra "hết một đợt": stage THẤP NHẤT còn item trên board đã xong hết
// (done/cancelled) trong khi một stage cao hơn vẫn còn item mở → trả
// {completedStage, nextStage} (nextStage = stage mở thấp nhất sau đó). Item
// không gán stage không tham gia sóng — vắng stage nghĩa là board phẳng.
//
// Đây là QUERY CÓ NHỚ: lần đầu một stage đạt "xong" mới trả kết quả, các lần
// sau trả null — nên caller cứ gọi thoải mái sau mỗi thay đổi mà không sợ spam
// channel (dedup theo ý nghĩa, không phải theo thời gian).
export async function checkStageWave(
  projectId: string,
): Promise<{ completedStage: number; nextStage: number } | null> {
  const board = await loadBoard(projectId)
  const staged = board.items.filter((i) => typeof i.stage === 'number')
  if (staged.length === 0) return null
  const stages = [...new Set(staged.map((i) => i.stage as number))].sort((a, b) => a - b)
  const lowest = stages[0] as number
  const isClosed = (i: BoardItem) => i.status === 'done' || i.status === 'cancelled'
  if (!staged.filter((i) => i.stage === lowest).every(isClosed)) return null
  const nextStage = stages.find(
    (s) => s > lowest && staged.some((i) => i.stage === s && !isClosed(i)),
  )
  if (nextStage === undefined) return null
  const seen = announcedWaves.get(projectId) ?? new Set<number>()
  if (seen.has(lowest)) return null
  seen.add(lowest)
  announcedWaves.set(projectId, seen)
  return { completedStage: lowest, nextStage }
}
