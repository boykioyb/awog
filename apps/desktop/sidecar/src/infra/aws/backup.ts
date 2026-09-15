// Sao lưu `~/.aws/{config,credentials}` trước MỖI lần ghi (ADR 0088 §1b, luật 2).
//
// Hai file đó hỏng thì người dùng mất quyền vào mọi thứ — một bản copy 2KB là
// bảo hiểm rẻ đến mức không đáng bàn. Bản sao lưu này KHÔNG phải để ngắm: nó là
// đường lùi mà `write.ts` thực sự đi khi bước verify sau khi ghi thất bại.
//
// Bản sao chứa secret y như bản gốc ⇒ thư mục `0700`, file `0600`, và tuyệt đối
// không đọc nội dung ra để log.

import { chmod, copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { constants as FS } from 'node:fs'
import { join } from 'node:path'
import { awogHome } from '../../util/path.js'

const DIR_NAME = 'aws-backups'

export function awsBackupDir(): string {
  return join(awogHome(), DIR_NAME)
}

// ISO 8601 đã sắp xếp được theo thứ tự thời gian khi so chuỗi; chỉ cần thay `:`
// và `.` cho hợp lệ trên mọi filesystem (Windows cấm `:`).
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

interface FsError extends Error {
  code?: string
}

function codeOf(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null ? (err as FsError).code : undefined
}

async function ensureDir(): Promise<string> {
  const dir = awsBackupDir()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  // `mode` của mkdir bị umask cắt, nên siết lại tường minh (và sửa cả thư mục
  // đã tồn tại từ trước với quyền lỏng hơn).
  await chmod(dir, 0o700)
  return dir
}

/**
 * Copy `path` vào `~/.awog/aws-backups/<basename>.<timestamp>`.
 * Trả về đường dẫn bản sao, hoặc `null` khi file nguồn chưa tồn tại — chưa có
 * `~/.aws/credentials` là trạng thái hợp lệ của máy chưa cài AWS CLI, không
 * phải lỗi.
 */
export async function backupAwsFile(path: string): Promise<string | null> {
  const dir = await ensureDir()
  const base = path.split(/[/\\]/).pop() || 'aws'
  const prefix = join(dir, `${base}.${stamp()}`)

  // `COPYFILE_EXCL` để hai lần ghi trong cùng một mili-giây không đè mất bản sao
  // của nhau; hậu tố chỉ xuất hiện khi thực sự đụng.
  for (let attempt = 0; attempt < 50; attempt++) {
    const dest = attempt === 0 ? prefix : `${prefix}-${attempt}`
    try {
      await copyFile(path, dest, FS.COPYFILE_EXCL)
      await chmod(dest, 0o600)
      return dest
    } catch (err) {
      const code = codeOf(err)
      if (code === 'ENOENT') return null // file nguồn chưa tồn tại
      if (code !== 'EEXIST') throw err
    }
  }
  throw new Error('Cannot allocate a backup filename')
}

/**
 * Giữ `keep` bản mới nhất CỦA TỪNG basename (`config` và `credentials` đếm
 * riêng), xoá phần dư.
 */
export async function pruneAwsBackups(basename: string, keep = 20): Promise<void> {
  const dir = awsBackupDir()
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (err) {
    if (codeOf(err) === 'ENOENT') return
    throw err
  }

  const prefix = `${basename}.`
  // Sắp theo TÊN giảm dần: dấu thời gian ISO đã mang đúng thứ tự, nên không cần
  // `stat` từng file (và không phụ thuộc mtime — thứ `copyFile` có thể giữ lại
  // từ file nguồn).
  const mine = names.filter((n) => n.startsWith(prefix)).sort((a, b) => b.localeCompare(a))
  for (const name of mine.slice(Math.max(keep, 0))) {
    await rm(join(dir, name), { force: true })
  }
}
