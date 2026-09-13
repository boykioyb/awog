// Nhà trên đĩa của ma trận quyền hạ tầng — ADR 0088 §5, §5b (task 0.7).
//
// `policy.ts` là hàm thuần: đưa vào một `InfraPolicy` thì nó trả lời auto/ask/
// block. File này trả lời câu trước đó: `InfraPolicy` ấy lấy ở đâu ra.
//
// VÌ SAO LÀ FILE RIÊNG, KHÔNG PHẢI MỘT LÁT TRONG `settings.json`.
// `settings/store.ts` cố ý là một blob KHÔNG lược đồ do UI sở hữu, ghi được bằng
// RPC `settings.set` với một patch tuỳ ý. Ma trận quyền thì ngược lại: sidecar là
// nơi giữ lược đồ, và ADR 0088 §5 đòi **mọi lần đổi quyền phải để lại một dòng
// nhật ký**. Để nó trong `settings.json` nghĩa là `settings.set` sửa được ma
// trận mà không đi qua `infra.policy.set` — tức là đổi quyền mà không ai ghi lại,
// đúng thứ ADR muốn chặn. Một file riêng khiến `infra.policy.*` là đường DUY NHẤT.
//
// LUẬT KHÔNG BAO GIỜ NÉM KHI ĐỌC. Cổng quyền gọi hàm ở đây trên đường nóng của
// mỗi tool call. Một file hỏng mà làm `loadInfraPolicy()` ném thì cổng quyền phải
// tự chọn fail-open hay fail-closed — cả hai đều sai (một bên mở toang, một bên
// làm app vô dụng). Nên đọc luôn trả về một chính sách hợp lệ: ô nào hỏng thì lấy
// đúng ô đó từ `DEFAULT_MATRIX`, phần còn lại của file vẫn được giữ.
//
// Ghi thì NGƯỢC LẠI: ghi hỏng phải ném, để `infra.policy.set` báo đỏ cho người
// dùng thay vì im lặng nuốt một thay đổi quyền.

import { mkdir, readFile, writeFile, chmod, rename } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { DEFAULT_MATRIX, defaultPolicy } from './policy.js'
import type { InfraAccountKind, InfraMatrix, InfraMode, InfraPolicy } from './policy.js'
import type { InfraCommandClass } from './types.js'

const FILE_NAME = sanitizeChild('infra-policy.json')

/** Ba lựa chọn bypass tạm thời (ADR 0088 §5, tính chất "hết hạn được"). */
export const BYPASS_MINUTES = [15, 30, 60] as const

export type BypassMinutes = (typeof BYPASS_MINUTES)[number]

/** Trần cho danh sách do người dùng nhập — chúng đến từ UI (L1). */
const MAX_PROD_ACCOUNTS = 200
const MAX_ACCOUNT_ID_CHARS = 64
const MAX_VOUCHED_PATHS = 20
const MAX_PATH_CHARS = 1024

/**
 * Chính sách + phần dữ liệu đi kèm nó trên đĩa. `vouchedBinaryPaths` (task 0.1b)
 * nằm ở đây chứ không nằm trong `InfraPolicy` vì `policy.ts` là hàm thuần của
 * quyết định auto/ask/block và không biết gì về filesystem.
 */
export type StoredInfraPolicy = InfraPolicy & {
  /** Realpath người dùng đã bảo lãnh tường minh cho `infra/binary.ts`. */
  vouchedBinaryPaths: readonly string[]
}

/** Cái `infra.policy.get` trả về — thêm phần dẫn xuất mà UI cần để đếm ngược. */
export type InfraPolicySnapshot = {
  matrix: InfraMatrix
  prodAccountIds: readonly string[]
  bypassUntil: string | null
  bypassSecondsLeft: number
  vouchedBinaryPaths: readonly string[]
}

function policyPath(): string {
  return join(awogHome(), FILE_NAME)
}

// Bốn lớp / hai cột lấy TỪ CHÍNH `DEFAULT_MATRIX` thay vì chép lại danh sách:
// thêm một lớp lệnh ở `types.ts` mà quên chỗ này thì ô mới im lặng biến mất khỏi
// bộ kiểm tra. `Object.keys` mất kiểu khoá nên phải ép một lần, ở đúng một chỗ.
const CLASSES = Object.keys(DEFAULT_MATRIX) as InfraCommandClass[]
const KINDS: readonly InfraAccountKind[] = ['normal', 'production']

const ModeSchema = z.enum(['auto', 'ask', 'block'])
const AccountIdSchema = z.string().trim().min(1).max(MAX_ACCOUNT_ID_CHARS)

// Không `.strict()`, không schema chặt cho `matrix`: một bản AWOG mới thêm lớp
// lệnh thì bản cũ phải bỏ qua khoá lạ, không được coi cả file là hỏng.
const FileSchema = z.object({
  matrix: z.unknown().optional(),
  prodAccountIds: z.unknown().optional(),
  bypassUntil: z.unknown().optional(),
  vouchedBinaryPaths: z.unknown().optional(),
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Ô nào đọc không ra thì lấy đúng ô đó từ mặc định — không vứt cả ma trận. */
function coerceMatrix(raw: unknown): { matrix: InfraMatrix; repaired: boolean } {
  const bag = isRecord(raw) ? raw : {}
  let repaired = !isRecord(raw) && raw !== undefined
  const matrix = {} as InfraMatrix
  for (const cls of CLASSES) {
    const column = isRecord(bag[cls]) ? (bag[cls] as Record<string, unknown>) : {}
    if (bag[cls] !== undefined && !isRecord(bag[cls])) repaired = true
    const cell = {} as Record<InfraAccountKind, InfraMode>
    for (const kind of KINDS) {
      const parsed = ModeSchema.safeParse(column[kind])
      if (parsed.success) {
        cell[kind] = parsed.data
        continue
      }
      if (column[kind] !== undefined) repaired = true
      cell[kind] = DEFAULT_MATRIX[cls][kind]
    }
    matrix[cls] = cell
  }
  return { matrix, repaired }
}

function coerceAccountIds(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    const parsed = AccountIdSchema.safeParse(item)
    if (!parsed.success) continue
    if (!out.includes(parsed.data)) out.push(parsed.data)
    if (out.length >= MAX_PROD_ACCOUNTS) break
  }
  return out
}

// Đường dẫn bảo lãnh phải TUYỆT ĐỐI và không chứa NUL: nó đi thẳng vào so sánh
// với realpath của một binary sắp được `execFile` gọi (invariant #8), nên một
// giá trị tương đối chỉ có thể là rác hoặc là mưu mẹo.
function coercePaths(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const value = item.trim()
    if (!value || value.length > MAX_PATH_CHARS) continue
    if (value.includes('\0') || !isAbsolute(value)) continue
    if (!out.includes(value)) out.push(value)
    if (out.length >= MAX_VOUCHED_PATHS) break
  }
  return out
}

function coerceBypass(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const ms = Date.parse(raw)
  if (Number.isNaN(ms)) return undefined
  return new Date(ms).toISOString()
}

function emptyStored(): StoredInfraPolicy {
  return { ...defaultPolicy(), vouchedBinaryPaths: [] }
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

async function readFromDisk(): Promise<StoredInfraPolicy> {
  const file = policyPath()
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    // Chưa có file là trạng thái CHẠY LẦN ĐẦU bình thường — không log ầm ĩ và
    // cũng không tạo file (mặc định sống trong code, không cần vật chất hoá).
    if (!isMissing(err)) {
      log.warn('infra policy: cannot read the policy file, falling back to defaults', {
        file,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    return emptyStored()
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    log.warn('infra policy: the policy file is not valid JSON, falling back to defaults', { file })
    return emptyStored()
  }
  const envelope = FileSchema.safeParse(raw)
  if (!envelope.success) {
    log.warn('infra policy: the policy file is not an object, falling back to defaults', { file })
    return emptyStored()
  }
  const { matrix, repaired } = coerceMatrix(envelope.data.matrix)
  if (repaired) {
    log.warn('infra policy: repaired unreadable cells from the factory matrix', { file })
  }
  const bypassUntil = coerceBypass(envelope.data.bypassUntil)
  return {
    matrix,
    prodAccountIds: coerceAccountIds(envelope.data.prodAccountIds),
    ...(bypassUntil !== undefined ? { bypassUntil } : {}),
    vouchedBinaryPaths: coercePaths(envelope.data.vouchedBinaryPaths),
  }
}

// ─── Cache + hàng đợi ghi ────────────────────────────────────────────────────
// Cache là Promise chứ không phải giá trị: hai tool call song song lúc khởi động
// chỉ tốn MỘT lượt đọc đĩa, và không ai thấy trạng thái nửa vời.
let cached: Promise<StoredInfraPolicy> | null = null
let writeChain: Promise<unknown> = Promise.resolve()

function invalidate(): void {
  cached = null
}

function loadStored(): Promise<StoredInfraPolicy> {
  if (!cached) cached = readFromDisk()
  return cached
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task)
  writeChain = run.catch(() => undefined)
  return run
}

// Ghi nguyên tử: tmp cùng thư mục → chmod 600 → rename. Rename trong cùng
// filesystem là nguyên tử, nên không có cửa sổ nào mà file chính sách nằm đó ở
// trạng thái ghi dở — đọc một ma trận cụt là đọc sai quyền.
async function writeStored(next: StoredInfraPolicy): Promise<void> {
  const file = policyPath()
  await mkdir(awogHome(), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp.${process.pid}`
  const body = {
    matrix: next.matrix,
    prodAccountIds: next.prodAccountIds,
    ...(next.bypassUntil !== undefined ? { bypassUntil: next.bypassUntil } : {}),
    vouchedBinaryPaths: next.vouchedBinaryPaths,
  }
  await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
  invalidate()
}

function update(
  mutate: (current: StoredInfraPolicy) => StoredInfraPolicy,
): Promise<StoredInfraPolicy> {
  return enqueue(async () => {
    const current = await loadStored()
    const next = mutate(current)
    await writeStored(next)
    return next
  })
}

// ─── Đọc ─────────────────────────────────────────────────────────────────────

/**
 * Chính sách đang hiệu lực. KHÔNG BAO GIỜ ném — file thiếu/hỏng trả về mặc định
 * xuất xưởng. Gọi trên đường nóng của cổng quyền nên có cache trong bộ nhớ; mọi
 * đường ghi ở file này tự vô hiệu hoá cache.
 */
export async function loadInfraPolicy(): Promise<InfraPolicy> {
  try {
    const stored = await loadStored()
    return {
      matrix: stored.matrix,
      prodAccountIds: stored.prodAccountIds,
      ...(stored.bypassUntil !== undefined ? { bypassUntil: stored.bypassUntil } : {}),
    }
  } catch (err) {
    // `readFromDisk` đã tự phòng thủ; nhánh này chỉ còn lỗi lập trình. Vẫn không
    // được để nó nổi lên cổng quyền.
    log.warn('infra policy: load failed, using the factory matrix', {
      err: err instanceof Error ? err.message : String(err),
    })
    invalidate()
    return defaultPolicy()
  }
}

/** Danh sách đường dẫn binary người dùng đã bảo lãnh (task 0.1b). Mặc định rỗng. */
export async function loadVouchedBinaryPaths(): Promise<readonly string[]> {
  try {
    return (await loadStored()).vouchedBinaryPaths
  } catch {
    return []
  }
}

function secondsLeft(bypassUntil: string | undefined, now: number): number {
  if (!bypassUntil) return 0
  const until = Date.parse(bypassUntil)
  if (Number.isNaN(until) || until <= now) return 0
  return Math.round((until - now) / 1000)
}

function snapshotOf(stored: StoredInfraPolicy, now = Date.now()): InfraPolicySnapshot {
  return {
    matrix: stored.matrix,
    prodAccountIds: stored.prodAccountIds,
    bypassUntil: stored.bypassUntil ?? null,
    bypassSecondsLeft: secondsLeft(stored.bypassUntil, now),
    vouchedBinaryPaths: stored.vouchedBinaryPaths,
  }
}

export async function getInfraPolicySnapshot(): Promise<InfraPolicySnapshot> {
  return snapshotOf(await loadStored())
}

// ─── Ghi ─────────────────────────────────────────────────────────────────────

/**
 * Ghi ma trận và/hoặc danh sách account production. Trường vắng mặt = giữ nguyên,
 * nên UI sửa một nửa màn hình không vô tình xoá nửa kia.
 */
export async function setInfraPolicy(patch: {
  matrix?: unknown
  prodAccountIds?: unknown
}): Promise<InfraPolicySnapshot> {
  const next = await update((current) => ({
    ...current,
    matrix: patch.matrix !== undefined ? coerceMatrix(patch.matrix).matrix : current.matrix,
    prodAccountIds:
      patch.prodAccountIds !== undefined
        ? coerceAccountIds(patch.prodAccountIds)
        : current.prodAccountIds,
  }))
  return snapshotOf(next)
}

/**
 * Bật/tắt bypass tạm thời. `null` = tắt ngay. Số phút bị giới hạn ở 15/30/60 —
 * bypass phải **hết hạn được** (ADR 0088 §5), nên ở đây không có đường ghi một
 * mốc xa tuỳ ý; muốn mở lâu dài thì phải sửa hẳn ô trong ma trận, nơi nhìn thấy được.
 */
export async function setInfraBypass(
  minutes: BypassMinutes | null,
  now = Date.now(),
): Promise<InfraPolicySnapshot> {
  const next = await update((current) => {
    if (minutes === null) {
      const { bypassUntil: _dropped, ...rest } = current
      return rest
    }
    return { ...current, bypassUntil: new Date(now + minutes * 60_000).toISOString() }
  })
  return snapshotOf(next, now)
}

/**
 * Thêm một realpath vào danh sách bảo lãnh (task 0.1b). Gọi từ
 * `infra/binary.ts` SAU khi đã verify đó là file thường + executable — store
 * không tự kiểm tra filesystem, nó chỉ giữ danh sách.
 */
export async function addVouchedBinaryPath(path: string): Promise<InfraPolicySnapshot> {
  const cleaned = coercePaths([path])
  if (cleaned.length === 0) throw new Error(`Not an absolute binary path: ${path}`)
  const wanted = cleaned[0]
  const next = await update((current) => {
    if (current.vouchedBinaryPaths.includes(wanted)) return current
    if (current.vouchedBinaryPaths.length >= MAX_VOUCHED_PATHS) {
      throw new Error(`Too many vouched binary paths (max ${MAX_VOUCHED_PATHS})`)
    }
    return { ...current, vouchedBinaryPaths: [...current.vouchedBinaryPaths, wanted] }
  })
  return snapshotOf(next)
}

/** Gỡ bảo lãnh. Không có đường nào cho agent gọi — đây là bề mặt của con người. */
export async function removeVouchedBinaryPath(path: string): Promise<InfraPolicySnapshot> {
  const next = await update((current) => ({
    ...current,
    vouchedBinaryPaths: current.vouchedBinaryPaths.filter((p) => p !== path),
  }))
  return snapshotOf(next)
}

/** Chỉ dùng trong test / sau khi sửa file bằng tay: buộc lần đọc sau chạm đĩa. */
export function invalidateInfraPolicyCache(): void {
  invalidate()
}
