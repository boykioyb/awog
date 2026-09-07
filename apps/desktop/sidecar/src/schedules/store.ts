// Lưu trữ lịch chạy (ADR 0082). Một file một lịch:
//   ~/.awog/schedules/<id>.json
//
// Mô hình y hệt ssh/store.ts: ghi nguyên tử qua `.tmp` + rename, xoá = unlink,
// đọc thì validate bằng zod rồi mới trả ra (file trên đĩa là L1). File nào hỏng
// thì bị BỎ QUA kèm log — một lịch hỏng không được làm chết cả danh sách.
//
// Lịch không chứa bí mật (chỉ có accountId, không có token) nên ghi thẳng, và
// vẫn chmod 600 cho đồng bộ với phần còn lại của `~/.awog`.

import { chmod, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { ScheduleSchema, type Schedule } from './schema.js'

const SCHEDULES_DIR = sanitizeChild('schedules')

function schedulesDir(): string {
  return join(awogHome(), SCHEDULES_DIR)
}

function scheduleFile(id: string): string {
  return join(schedulesDir(), `${sanitizeChild(id)}.json`)
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

// Tên file là nguồn chân lý cho `id`: file bị sửa tay thiếu `id` vẫn dùng được
// thay vì bị vứt lặng lẽ (cùng cách xử lý với mcp/store.ts + ssh/store.ts).
function parse(raw: string, file: string): Schedule | null {
  try {
    const obj = JSON.parse(raw) as unknown
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const rec = obj as { id?: unknown }
      if (typeof rec.id !== 'string') {
        const name = basename(file)
        rec.id = name.endsWith('.json') ? name.slice(0, -5) : name
      }
    }
    const res = ScheduleSchema.safeParse(obj)
    if (!res.success) {
      log.warn('schedules: invalid schedule file', {
        file,
        issues: res.error.issues.map((i) => `${i.path.join('.')}:${i.message}`),
      })
      return null
    }
    return res.data
  } catch (err) {
    log.warn('schedules: failed to parse schedule', {
      file,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

async function writeAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

export async function loadSchedule(id: string): Promise<Schedule | null> {
  const file = scheduleFile(id)
  try {
    return parse(await readFile(file, 'utf8'), file)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

export async function listSchedules(): Promise<Schedule[]> {
  let entries: string[]
  try {
    entries = await readdir(schedulesDir())
  } catch (err) {
    if (isMissing(err)) return []
    throw err
  }
  const out: Schedule[] = []
  for (const name of entries) {
    if (!name.endsWith('.json') || name.includes('.tmp.')) continue
    const file = join(schedulesDir(), name)
    try {
      // eslint-disable-next-line no-await-in-loop
      const parsed = parse(await readFile(file, 'utf8'), file)
      if (parsed) out.push(parsed)
    } catch (err) {
      log.warn('schedules: failed to read schedule file', {
        file,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export async function saveSchedule(schedule: Schedule): Promise<void> {
  await mkdir(schedulesDir(), { recursive: true, mode: 0o700 })
  await writeAtomic(scheduleFile(schedule.id), schedule)
}

export async function deleteSchedule(id: string): Promise<void> {
  try {
    await unlink(scheduleFile(id))
  } catch (err) {
    if (!isMissing(err)) throw err
  }
}
