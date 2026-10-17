// Cờ "phiên đã từng nhận nội dung Slack" (docs/features/slack-threads.md, mục Bảo mật).
//
// Khối thread giao vào phiên là chữ NGƯỜI NGOÀI viết (L1) và nằm luôn trong transcript
// — mọi lượt sau model vẫn đọc lại nó. Nên các chốt của `sessions.sendMessage` (loại
// nguồn MCP Slack, bỏ autoApprove, kẹp mode về `ask`) phải áp cho MỌI lượt của phiên,
// kể cả khi người dùng đã gỡ thread / xoá liên kết. Liên kết thread (`thread.sessionId`)
// gỡ được nên không đủ làm căn cứ; cờ ở đây thì chỉ thêm, KHÔNG BAO GIỜ gỡ.
//
// Lưu riêng ở `~/.awog/slack/tainted-sessions.json` thay vì header phiên: header bị
// `sessions.upsert` (mode create) dựng lại từ payload renderer, nên một cờ nằm đó có
// thể bị ghi đè mất; file này chỉ sidecar ghi.
//
// FAIL CLOSED: file hỏng / đọc lỗi ⇒ coi MỌI phiên là đã nhiễm. Cố ý KHÔNG dùng
// `readJsonFile` (nó cách ly file hỏng rồi trả rỗng ⇒ lần đọc sau mất hết cờ).
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { log } from '../util/logger.js'
import { serialize, slackHome, writeJsonAtomic } from './json-file.js'
import { listThreads } from './store.js'

// Id phiên (engineId) — rộng như `sessions/browser-previews.ts`: đủ cho mọi dạng id đang
// có, đủ hẹp để file không chứa rác.
const SESSION_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/

const TaintFileSchema = z.object({
  version: z.literal(1),
  sessionIds: z.array(z.string().regex(SESSION_ID_RE)),
})

const WRITE_KEY = 'slack-tainted-sessions'

function taintFile(): string {
  return join(slackHome(), 'tainted-sessions.json')
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
}

// Tập id đã nhiễm. File chưa có ⇒ rỗng. Mọi lỗi khác (I/O, JSON hỏng, sai schema) ⇒ NÉM
// — caller quyết định fail closed.
async function readTaintedIds(): Promise<Set<string>> {
  let raw: string
  try {
    raw = await readFile(taintFile(), 'utf8')
  } catch (err) {
    if (isMissing(err)) return new Set()
    throw err
  }
  const parsed = TaintFileSchema.parse(JSON.parse(raw))
  return new Set(parsed.sessionIds)
}

/**
 * Đánh dấu phiên đã nhận nội dung Slack. Gọi TRƯỚC khi giao khối: ghi cờ hỏng thì
 * ném và không giao gì (fail closed). Ghi lặp lại vô hại.
 */
export function markSessionSlackTainted(sessionId: string): Promise<void> {
  if (!SESSION_ID_RE.test(sessionId)) {
    return Promise.reject(new Error(`invalid session id for slack taint: ${sessionId}`))
  }
  return serialize(WRITE_KEY, async () => {
    const ids = await readTaintedIds()
    if (ids.has(sessionId)) return
    ids.add(sessionId)
    await writeJsonAtomic(taintFile(), { version: 1, sessionIds: [...ids] })
  })
}

/**
 * Phiên con (fork) mang theo transcript của phiên cha ⇒ thừa kế cờ. Đọc lỗi thì bỏ qua:
 * khi đó `isSessionSlackTainted` đã coi mọi phiên (kể cả phiên con) là nhiễm.
 */
export async function inheritSlackTaint(childId: string, parentId: string): Promise<void> {
  let ids: Set<string>
  try {
    ids = await readTaintedIds()
  } catch {
    return
  }
  if (ids.has(parentId)) await markSessionSlackTainted(childId)
}

/**
 * Phiên đã từng nhận nội dung Slack: có cờ, HOẶC đang gắn một thread (phiên tạo trước
 * khi có cờ). Đọc lỗi ở bất kỳ nguồn nào ⇒ true.
 */
export async function isSessionSlackTainted(sessionId: string): Promise<boolean> {
  try {
    if ((await readTaintedIds()).has(sessionId)) return true
  } catch (err) {
    log.warn('slack: cannot read tainted-session list; treating session as tainted', {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    })
    return true
  }
  try {
    return (await listThreads()).some((t) => t.sessionId === sessionId)
  } catch (err) {
    log.warn('slack: cannot read thread list; treating session as tainted', {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    })
    return true
  }
}
