// Đường ghi DUY NHẤT vào `~/.aws/{config,credentials}` (ADR 0088 §1b, Mốc 1 A1).
//
// Bốn luật của §1b nằm gọn trong `applyAwsIniEdits`, theo đúng thứ tự này:
//   đọc → sửa phẫu thuật (`ini-edit.ts`) → **sao lưu bản CŨ** → tmp cùng thư mục
//   → chmod 600 → rename (nguyên tử) → **đọc lại và verify** → prune.
// Verify hỏng ⇒ khôi phục từ chính bản sao lưu vừa tạo rồi ném `VERIFY_FAILED`.
// Đó là lý do bản sao lưu tồn tại — tạo rồi bỏ đó thì nó chỉ là rác.
//
// INVARIANT #1/#3: giá trị secret đi qua đây trong ĐÚNG một lần ghi. Không log
// `raw`, không log nội dung mới, không log giá trị khoá nào — mọi log bên dưới
// chỉ có đường dẫn và tên khoá. Module này cũng KHÔNG tự ghi nhật ký hành động:
// `recordInfraAction` cần `actor` (human / agent:<tên>), thứ chỉ tầng RPC biết,
// nên việc ghi nhật ký thuộc về người gọi.
//
// KHÔNG có AgentTool nào gọi được hàm này: CRUD credential là bề mặt chỉ của
// con người (ADR 0088 §1b, luật 4). Chỉ RPC do UI gọi mới được đi vào đây.

import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { log } from '../../util/logger.js'
import { backupAwsFile, pruneAwsBackups } from './backup.js'
import { editAwsIni, normalizeSectionName, type IniEdit } from './ini-edit.js'
import { parseAwsIni, type AwsIniFile } from './ini.js'
import { awsConfigPath, awsCredentialsPath } from './profiles.js'

export type AwsIniTarget = 'config' | 'credentials'

const STATIC_KEYS = ['aws_access_key_id', 'aws_secret_access_key'] as const
const SESSION_TOKEN = 'aws_session_token'

interface FsError extends Error {
  code?: string
}

function codeOf(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null ? (err as FsError).code : undefined
}

function pathFor(target: AwsIniTarget): string {
  return target === 'config' ? awsConfigPath() : awsCredentialsPath()
}

// Hàng đợi theo TỪNG file: hai lần ghi song song (UI bấm nhanh hai lần, hoặc
// sửa profile trong khi luồng nhập đang chạy) sẽ đọc cùng một bản `raw` rồi ghi
// đè lẫn nhau — lần sau nuốt mất thay đổi của lần trước.
const queues = new Map<string, Promise<unknown>>()

function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve()
  // Nối vào cả nhánh hỏng: một lần ghi lỗi không được phép khoá vĩnh viễn file.
  const run = prev.then(fn, fn)
  queues.set(
    key,
    run.catch(() => undefined),
  )
  return run
}

function verifyFailed(reason: string): Error {
  const err = new Error(`VERIFY_FAILED: ${reason}`)
  err.name = 'VERIFY_FAILED'
  return err
}

// Đối chiếu bản vừa ghi (đọc lại từ đĩa) với ý định của từng edit. Chỉ so được
// những gì `parseAwsIni` cho qua — ba khoá secret chỉ còn boolean, nên với
// chúng ta xác nhận "có mặt", không xác nhận giá trị. Đó là cái giá của
// invariant #1 và là cái giá đúng.
function verifyEdits(parsed: AwsIniFile, edits: readonly IniEdit[]): void {
  for (const edit of edits) {
    // Tra cứu bằng tên ĐÃ CHUẨN HOÁ. `editAwsIni` ghi `[profile dev]` cho cả
    // `'profile  dev'`, còn `parseAwsIni` trả khoá `'profile dev'` — tra bằng
    // chuỗi thô thì một lần ghi hoàn toàn đúng bị báo "section missing" rồi
    // cuộn ngược.
    if (edit.op === 'deleteSection') {
      const name = normalizeSectionName(edit.section)
      if (parsed[name]) throw verifyFailed(`section still present: ${name}`)
      continue
    }
    if (edit.op === 'renameSection') {
      const from = normalizeSectionName(edit.from)
      const to = normalizeSectionName(edit.to)
      if (!parsed[to]) throw verifyFailed(`renamed section missing: ${to}`)
      if (parsed[from]) throw verifyFailed(`old section still present: ${from}`)
      continue
    }
    if (edit.op === 'copySection') {
      const fromName = normalizeSectionName(edit.from)
      const toName = normalizeSectionName(edit.to)
      const src = parsed[fromName]
      const dst = parsed[toName]
      if (!src) throw verifyFailed(`source section missing: ${fromName}`)
      if (!dst) throw verifyFailed(`copied section missing: ${toName}`)
      // Bản sao phải TƯƠNG ĐƯƠNG bản gốc dưới con mắt của `parseAwsIni` — đó là
      // tất cả những gì đo được mà không chạm vào giá trị secret: hai boolean
      // nói "có khoá" và mọi khoá không-secret phải trùng giá trị.
      if (dst.hasStaticKeys !== src.hasStaticKeys || dst.hasSessionToken !== src.hasSessionToken) {
        throw verifyFailed(`copied section lost its keys: ${toName}`)
      }
      for (const [key, value] of Object.entries(src.keys)) {
        if (dst.keys[key] !== value) throw verifyFailed(`copied key mismatch: ${toName}.${key}`)
      }
      continue
    }

    const name = normalizeSectionName(edit.section)
    const section = parsed[name]
    if (!section) throw verifyFailed(`section missing: ${name}`)

    for (const [rawKey, rawValue] of Object.entries(edit.keys)) {
      const key = rawKey.trim().toLowerCase()
      const value = rawValue.trim()
      if (STATIC_KEYS.includes(key as (typeof STATIC_KEYS)[number])) {
        if (!section.hasStaticKeys) throw verifyFailed(`static keys missing in ${name}`)
        continue
      }
      if (key === SESSION_TOKEN) {
        if (!section.hasSessionToken) throw verifyFailed(`session token missing in ${name}`)
        continue
      }
      if (section.keys[key] !== value) throw verifyFailed(`key not written: ${name}.${key}`)
    }

    const removed = (edit.removeKeys ?? []).map((k) => k.trim().toLowerCase())
    for (const key of removed) {
      if (key === SESSION_TOKEN) {
        if (section.hasSessionToken) throw verifyFailed(`session token still present`)
        continue
      }
      // Hai khoá static chung một boolean: chỉ khẳng định được khi xoá cả cặp.
      if (STATIC_KEYS.includes(key as (typeof STATIC_KEYS)[number])) {
        if (STATIC_KEYS.every((k) => removed.includes(k)) && section.hasStaticKeys) {
          throw verifyFailed(`static keys still present in ${name}`)
        }
        continue
      }
      if (section.keys[key] !== undefined) {
        throw verifyFailed(`key not removed: ${name}.${key}`)
      }
    }
  }
}

// Hàng rào cho lời hứa lớn nhất của trình soạn phẫu thuật: "sửa profile A
// không đụng profile B". `verifyEdits` chỉ khẳng định thứ ĐƯỢC YÊU CẦU đã xảy
// ra — nó không thấy một profile khác vừa bốc hơi. So bản đọc lại với bản đọc
// TRƯỚC khi ghi, bỏ qua đúng những section mà lệnh có quyền chạm.
function verifyUntouched(
  before: AwsIniFile,
  after: AwsIniFile,
  edits: readonly IniEdit[],
): void {
  const touched = new Set<string>()
  for (const edit of edits) {
    if (edit.op === 'upsertSection' || edit.op === 'deleteSection') {
      touched.add(normalizeSectionName(edit.section))
    } else {
      touched.add(normalizeSectionName(edit.from))
      touched.add(normalizeSectionName(edit.to))
    }
  }

  for (const [name, was] of Object.entries(before)) {
    if (touched.has(name)) continue
    const now = after[name]
    if (!now) throw verifyFailed(`unrelated section disappeared: ${name}`)
    // Hai boolean là tất cả những gì đo được về credential mà không chạm giá
    // trị (invariant #1) — nhưng chúng đủ để bắt "dòng secret của B biến mất".
    if (now.hasStaticKeys !== was.hasStaticKeys || now.hasSessionToken !== was.hasSessionToken) {
      throw verifyFailed(`unrelated credentials changed: ${name}`)
    }
    for (const [key, value] of Object.entries(was.keys)) {
      if (now.keys[key] !== value) throw verifyFailed(`unrelated key changed: ${name}.${key}`)
    }
    for (const key of Object.keys(now.keys)) {
      if (was.keys[key] === undefined) throw verifyFailed(`unrelated key appeared: ${name}.${key}`)
    }
  }

  // Vòng ĐỐI XỨNG: vòng trên chỉ duyệt những section từng tồn tại, nên một
  // section LẠ mới mọc ra (một giá trị lách được `assertValue` và tự mở section,
  // hay một lỗi của trình soạn) lọt qua sạch. Section mới hợp lệ luôn nằm trong
  // `touched` vì `upsertSection` phải khai tên nó.
  for (const name of Object.keys(after)) {
    if (touched.has(name)) continue
    if (!before[name]) throw verifyFailed(`unrelated section appeared: ${name}`)
  }
}

async function assertOwnerOnly(path: string): Promise<void> {
  const st = await stat(path)
  const mode = st.mode & 0o777
  if (mode !== 0o600) throw verifyFailed(`mode is ${mode.toString(8)}, expected 600`)
}

// Đường lùi: trả file về đúng trạng thái trước khi ghi. Không có bản sao lưu
// nghĩa là trước đó file CHƯA tồn tại ⇒ khôi phục = xoá nó đi.
async function restore(path: string, backup: string | null): Promise<void> {
  if (backup === null) {
    await rm(path, { force: true })
    return
  }
  await copyFile(backup, path)
  await chmod(path, 0o600)
}

/**
 * Giải symlink trước khi ghi.
 *
 * `rename()` thay thế chính entry mang tên đó, nên ghi nguyên tử vào một
 * `~/.aws/credentials` là SYMLINK sẽ CẮT symlink: chỗ cũ (thường là một dotfiles
 * repo) đứng im với nội dung cũ, còn `~/.aws/credentials` thành file thường —
 * người dùng mất liên kết mà không có một dòng báo nào. Đây là cấu hình rất phổ
 * biến, nên đường ghi phải đi xuyên qua nó tới file thật.
 */
async function resolveWriteTarget(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (err) {
    if (codeOf(err) !== 'ENOENT') throw err
  }
  // `realpath` cũng ném ENOENT khi symlink trỏ vào một file CHƯA tồn tại —
  // trường hợp đó vẫn phải tạo file ở đầu kia của liên kết.
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      return resolve(dirname(path), await readlink(path))
    }
  } catch (err) {
    if (codeOf(err) !== 'ENOENT') throw err
  }
  return path
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  // Tên tmp ngẫu nhiên + cờ `wx` (O_CREAT|O_EXCL): tên đoán được cộng với ghi
  // đè cho phép ai đó đặt sẵn một symlink ở đúng chỗ đó và hứng trọn file
  // credential sang nơi khác. `wx` từ chối cả file lẫn symlink đã tồn tại.
  const tmp = `${path}.awog-${randomBytes(8).toString('hex')}.tmp`
  let created = false
  try {
    // `mode` của writeFile bị umask cắt nên siết lại tường minh trước khi
    // rename — file phải đã đúng quyền TẠI thời điểm nó mang tên thật.
    await writeFile(tmp, content, { mode: 0o600, flag: 'wx' })
    created = true
    await chmod(tmp, 0o600)
    await rename(tmp, path)
    created = false
  } catch (err) {
    // Chỉ dọn thứ mình vừa tạo: `wx` hỏng vì đụng file lạ thì file đó không
    // phải của ta.
    if (created) await rm(tmp, { force: true })
    throw err
  }
}

/**
 * Áp một chuỗi thao tác lên `~/.aws/config` hoặc `~/.aws/credentials`.
 *
 * Trả về đường dẫn bản sao lưu vừa tạo (hoặc `null` khi file trước đó chưa tồn
 * tại, hoặc khi nội dung không đổi nên không có lần ghi nào xảy ra).
 */
export async function applyAwsIniEdits(
  target: AwsIniTarget,
  edits: readonly IniEdit[],
): Promise<{ backup: string | null }> {
  const path = pathFor(target)

  return withFileLock(path, async () => {
    let raw = ''
    try {
      raw = await readFile(path, 'utf8')
    } catch (err) {
      if (codeOf(err) !== 'ENOENT' && codeOf(err) !== 'ENOTDIR') throw err
    }

    // Ném TRƯỚC khi chạm đĩa: tên section sai, khoá ngoài allowlist, giá trị có
    // xuống dòng — không có gì để khôi phục vì chưa có gì xảy ra.
    const next = editAwsIni(raw, edits)
    if (next === raw) {
      log.info('aws: ini unchanged, skipping write', { path })
      return { backup: null }
    }

    const before = parseAwsIni(raw)
    const file = await resolveWriteTarget(path)
    const backup = await backupAwsFile(path)
    await writeAtomic(file, next)

    try {
      const written = await readFile(file, 'utf8')
      const parsed = parseAwsIni(written)
      verifyEdits(parsed, edits)
      verifyUntouched(before, parsed, edits)
      if (target === 'credentials') await assertOwnerOnly(file)
    } catch (err) {
      await restore(file, backup)
      log.error('aws: ini verify failed, restored from backup', {
        path,
        backup,
        err: err instanceof Error ? err.message : String(err),
      })
      throw err
    }

    await pruneAwsBackups(path.split(/[/\\]/).pop() || target)
    return { backup }
  })
}
