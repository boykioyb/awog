// Log của từng lượt chạy job `command` (ADR 0108) — `~/.awog/schedule-logs/<id lịch>/<id lượt>.log`.
//
// Lịch sử chạy trong file lịch chỉ giữ dòng cuối của output (đủ cho danh sách); người dùng
// cần xem lệnh đã làm gì thì đọc log này qua RPC `schedules.runLog`. Nội dung đã qua
// redact (output của script có thể in token) và chỉ giữ đuôi — cùng trần với runner.
// Mỗi lịch giữ tối đa MAX_RUN_HISTORY log, khớp số dòng lịch sử; xoá lịch thì xoá log.
//
// Nằm NGOÀI `~/.awog/schedules/` để store lịch (đọc mọi `*.json` ở đó) và watcher không
// phải biết tới nó.

import { chmod, mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { redactString } from '../sessions/redact.js'
import { MAX_RUN_HISTORY } from './schema.js'

export const RUN_ID_RE = /^run-[a-f0-9]{12}$/

function logDir(scheduleId: string): string {
  return join(awogHome(), 'schedule-logs', sanitizeChild(scheduleId))
}

export async function writeRunLog(scheduleId: string, runId: string, text: string): Promise<void> {
  const dir = logDir(scheduleId)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, `${sanitizeChild(runId)}.log`)
  await writeFile(file, redactString(text), 'utf8')
  await chmod(file, 0o600)
  // Giữ đúng số log khớp lịch sử chạy — log cũ hơn dòng lịch sử cuối không còn ai mở.
  const files = (await readdir(dir)).filter((f) => f.endsWith('.log'))
  if (files.length <= MAX_RUN_HISTORY) return
  const aged = await Promise.all(files.map(async (f) => ({ f, at: (await stat(join(dir, f))).mtimeMs })))
  aged.sort((a, b) => b.at - a.at)
  await Promise.all(aged.slice(MAX_RUN_HISTORY).map(({ f }) => unlink(join(dir, f)).catch(() => {})))
}

export async function readRunLog(scheduleId: string, runId: string): Promise<string | null> {
  try {
    return await readFile(join(logDir(scheduleId), `${sanitizeChild(runId)}.log`), 'utf8')
  } catch {
    return null
  }
}

export async function deleteRunLogs(scheduleId: string): Promise<void> {
  await rm(logDir(scheduleId), { recursive: true, force: true })
}
