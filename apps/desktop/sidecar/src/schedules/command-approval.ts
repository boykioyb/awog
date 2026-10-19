// Sổ duyệt cho job `command` của lịch chạy (ADR 0108, docs/features/scheduled-runs.md).
//
// Lịch nằm ở `~/.awog/schedules/<id>.json` — file L1, và script mà lệnh chạy thường nằm
// ở chỗ agent ghi được. Nên "đã duyệt" KHÔNG đọc từ file lịch, mà từ một sổ do sidecar
// giữ trong Keychain: `id lịch → digest`. Digest phủ:
//   • id lịch (chép lệnh sang lịch khác ⇒ không khớp),
//   • realpath của program + args + timeout,
//   • sha256 NỘI DUNG của program và của mọi arg là đường dẫn tuyệt đối tới một file —
//     agent sửa script (quyền Write thường tự duyệt) ⇒ lệnh thành chưa duyệt.
// Ghi sổ chỉ ở `schedules.upsert` khi payload mang `approve: true`, mà UI chỉ gửi cờ đó
// sau hộp xác nhận liệt kê program + từng arg. Bật/tắt lịch (`schedules.setEnabled`)
// không đụng sổ. Xoá lịch ⇒ xoá dòng của nó (thu hồi).
//
// Giới hạn đã biết: file mà script tự import/đọc bắc cầu (module Python, file cấu hình)
// không nằm trong digest. Keychain lỗi lúc đọc trả về như "chưa có sổ" (keychain.ts) ⇒
// duyệt khi đó ghi đè sổ và các lịch khác phải duyệt lại — fail closed, không mở.

import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { getKeychainValue, setKeychainValue } from '../credentials/keychain.js'
import { DEFAULT_COMMAND_TIMEOUT_MINUTES, type ScheduleJob } from './schema.js'

type CommandJob = Extract<ScheduleJob, { kind: 'command' }>

const SERVICE = 'awog-schedules'
const ACCOUNT = 'approved-commands'

async function fileHash(path: string): Promise<string | null> {
  try {
    const real = await realpath(path)
    if (!(await stat(real)).isFile()) return null
    return `${real}:${createHash('sha256').update(await readFile(real)).digest('hex')}`
  } catch {
    return null
  }
}

export async function commandDigest(id: string, job: CommandJob): Promise<string> {
  const files = await Promise.all(
    [job.program, ...job.args].filter((a) => isAbsolute(a)).map((a) => fileHash(a)),
  )
  const timeout = job.timeoutMinutes ?? DEFAULT_COMMAND_TIMEOUT_MINUTES
  return createHash('sha256')
    .update(JSON.stringify([id, job.program, job.args, timeout, files]))
    .digest('hex')
}

async function readLedger(): Promise<Record<string, string>> {
  const raw = await getKeychainValue(SERVICE, ACCOUNT)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

// Đọc-sửa-ghi sổ nối tiếp nhau: hai lần lưu cùng lúc không được nuốt dòng của nhau.
let ledgerChain: Promise<unknown> = Promise.resolve()

function mutateLedger(mutate: (ledger: Record<string, string>) => void): Promise<void> {
  const next = ledgerChain.then(async () => {
    const ledger = await readLedger()
    mutate(ledger)
    await setKeychainValue(SERVICE, ACCOUNT, JSON.stringify(ledger))
  })
  ledgerChain = next.catch(() => undefined)
  return next
}

export async function approveCommand(id: string, job: CommandJob): Promise<void> {
  const digest = await commandDigest(id, job)
  await mutateLedger((ledger) => {
    ledger[id] = digest
  })
}

export async function revokeCommand(id: string): Promise<void> {
  await mutateLedger((ledger) => {
    delete ledger[id]
  })
}

export async function isCommandApproved(id: string, job: CommandJob): Promise<boolean> {
  const approved = (await readLedger())[id]
  return approved !== undefined && approved === (await commandDigest(id, job))
}
