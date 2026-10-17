// Đọc/ghi file JSON dưới `~/.awog/slack/` — dùng chung cho danh sách thread và
// các cache (directory, bản dịch).
//
// File hỏng (JSON lỗi hoặc sai schema) được ĐỔI TÊN thành `.corrupt-<thời điểm>`
// trước khi coi như rỗng. Nếu chỉ "coi như rỗng" thì lần ghi kế tiếp (thêm một
// thread, một nhịp poll) sẽ đè mất bản cũ — người dùng mất toàn bộ danh sách
// thread vì một lần ghi dở. Giữ bản hỏng lại thì còn đường cứu bằng tay.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { ZodTypeAny, output } from 'zod'
import { awogHome } from '../util/path.js'
import { log } from '../util/logger.js'

export function slackHome(): string {
  return join(awogHome(), 'slack')
}

function isMissing(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

async function quarantine(file: string, reason: string): Promise<void> {
  const backup = `${file}.corrupt-${Date.now()}`
  try {
    await rename(file, backup)
    log.warn('slack: corrupt file moved aside', { file, backup, reason })
  } catch (err) {
    log.warn('slack: failed to move corrupt file aside', {
      file,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

// null = file chưa có HOẶC hỏng (đã cách ly). Lỗi I/O khác (quyền, đĩa) thì
// ném lên: coi như rỗng trong trường hợp đó sẽ đè mất file thật ở lần ghi sau.
export async function readJsonFile<S extends ZodTypeAny>(
  file: string,
  schema: S,
): Promise<output<S> | null> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    await quarantine(file, 'invalid JSON')
    return null
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    await quarantine(
      file,
      parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    )
    return null
  }
  return parsed.data as output<S>
}

// Ghi atomic: tmp cùng thư mục (rename không vượt filesystem) + rename. Hậu tố
// ngẫu nhiên để hai lần ghi chồng nhau không giẫm lên cùng một file tmp.
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await writeTextAtomic(file, JSON.stringify(value, null, 2))
}

// Như writeJsonAtomic nhưng cho file chữ (bảng thuật ngữ `glossary.md`).
export async function writeTextAtomic(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`
  try {
    await writeFile(tmp, text, { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, file)
  } catch (err) {
    // Đĩa đầy / rename hỏng: không để `*.tmp.*` rơi rớt lại mỗi lần ghi lỗi (poll
    // ghi mỗi phút — vài giờ là cả trăm file rác).
    await rm(tmp, { force: true }).catch(() => undefined)
    throw err
  }
}

// Hàng đợi ghi theo khoá: mọi thao tác đọc-sửa-ghi trên cùng một file đi tuần
// tự, nên hai RPC chạy song song (poll + markSeen) không làm mất cập nhật của nhau.
const chains = new Map<string, Promise<unknown>>()

export function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  const next = prev.then(task, task)
  const settled = next.catch(() => undefined)
  chains.set(key, settled)
  void settled.then(() => {
    if (chains.get(key) === settled) chains.delete(key)
  })
  return next
}
