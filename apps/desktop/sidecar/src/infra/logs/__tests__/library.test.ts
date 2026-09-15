// Mốc 2 việc 2.4 — thư viện query.
//
// Thứ đáng đo KHÔNG phải "JSON ghi ra có đúng không" mà là hai luật nằm sau chức
// năng: (a) một file phụ trợ hỏng KHÔNG được làm màn Logs không mở được, và
// (b) số đo của lần chạy THÀNH CÔNG mới được dùng để ước lượng lần sau — một lần
// chạy bị huỷ giữa đường trả `bytesScanned` rất nhỏ, và lấy nó làm cơ sở sẽ dạy
// app rằng câu đó rẻ, đúng lúc nó không rẻ.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  MAX_HISTORY,
  MAX_SAVED,
  clearHistory,
  deleteSavedQuery,
  lastBytesFor,
  logsLibraryDir,
  logsLibraryFile,
  readLibrary,
  recordRun,
  saveQuery,
} from '../library.js'

let dir = ''
const savedEnv: Record<string, string | undefined> = {}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'awog-logs-library-'))
  for (const k of ['HOME', 'USERPROFILE']) savedEnv[k] = process.env[k]
  process.env.HOME = dir
  process.env.USERPROFILE = dir
})

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

const QUERY = 'fields @timestamp, @message | sort @timestamp desc | limit 20'

describe('đọc', () => {
  it('file chưa có ⇒ thư viện rỗng, KHÔNG ném', async () => {
    await expect(readLibrary()).resolves.toEqual({ saved: [], history: [] })
  })

  it('file hỏng (không phải JSON) ⇒ thư viện rỗng, KHÔNG ném', async () => {
    await mkdir(logsLibraryDir(), { recursive: true })
    await writeFile(logsLibraryFile(), '{ this is not json', 'utf8')
    await expect(readLibrary()).resolves.toEqual({ saved: [], history: [] })
  })

  it('file đúng JSON nhưng sai lược đồ ⇒ thư viện rỗng, KHÔNG ném', async () => {
    await mkdir(logsLibraryDir(), { recursive: true })
    await writeFile(logsLibraryFile(), JSON.stringify({ saved: [{ nope: 1 }] }), 'utf8')
    await expect(readLibrary()).resolves.toEqual({ saved: [], history: [] })
  })
})

describe('câu đã lưu', () => {
  it('lưu lần đầu rồi lưu lại cùng tên thì GHI ĐÈ, không tạo bản trùng', async () => {
    const first = await saveQuery({
      name: 'Lỗi gần đây',
      query: QUERY,
      logGroups: ['/aws/lambda/a'],
      windowSeconds: 3600,
    })
    const second = await saveQuery({
      name: 'Lỗi gần đây',
      query: `${QUERY} | filter @message like /x/`,
      logGroups: ['/aws/lambda/a'],
      windowSeconds: 7200,
    })
    expect(second.id).toBe(first.id)
    const library = await readLibrary()
    expect(library.saved).toHaveLength(1)
    expect(library.saved[0]?.windowSeconds).toBe(7200)
  })

  it('vượt trần thì TỪ CHỐI kèm mã đọc được, không cắt im lặng', async () => {
    const library = await readLibrary()
    void library
    await mkdir(logsLibraryDir(), { recursive: true })
    // Dựng thẳng một file đã đầy thay vì lưu 200 lần — nhanh hơn và đo đúng nhánh.
    const full = {
      version: 1,
      saved: Array.from({ length: MAX_SAVED }, (_, i) => ({
        id: `id-${String(i)}`,
        name: `câu ${String(i)}`,
        query: QUERY,
        logGroups: ['/aws/lambda/a'],
        windowSeconds: 3600,
        savedAt: '2026-09-13T00:00:00.000Z',
      })),
      history: [],
    }
    await writeFile(logsLibraryFile(), JSON.stringify(full), 'utf8')
    await expect(
      saveQuery({
        name: 'câu mới',
        query: QUERY,
        logGroups: ['/aws/lambda/a'],
        windowSeconds: 3600,
      }),
    ).rejects.toThrow(/TOO_MANY_SAVED/)
  })

  it('xoá theo id; id lạ thì trả `removed: false` chứ không ném', async () => {
    const entry = await saveQuery({
      name: 'A',
      query: QUERY,
      logGroups: ['/aws/lambda/a'],
      windowSeconds: 3600,
    })
    await expect(deleteSavedQuery(entry.id)).resolves.toEqual({ removed: true })
    await expect(deleteSavedQuery(entry.id)).resolves.toEqual({ removed: false })
  })
})

describe('lịch sử và số đo', () => {
  it('lần chạy Complete cập nhật số đo của câu ĐÃ LƯU cùng câu lệnh', async () => {
    await saveQuery({
      name: 'A',
      query: QUERY,
      logGroups: ['/aws/lambda/a'],
      windowSeconds: 3600,
    })
    await recordRun({
      query: QUERY,
      logGroups: ['/aws/lambda/a'],
      windowSeconds: 3600,
      bytesScanned: 1024 ** 3,
      recordsMatched: 3,
      status: 'Complete',
    })
    await expect(lastBytesFor(QUERY)).resolves.toBe(1024 ** 3)
  })

  it('lần chạy bị HUỶ không được dạy app rằng câu đó rẻ', async () => {
    await saveQuery({
      name: 'A',
      query: QUERY,
      logGroups: ['/aws/lambda/a'],
      windowSeconds: 3600,
    })
    await recordRun({
      query: QUERY,
      logGroups: ['/aws/lambda/a'],
      windowSeconds: 3600,
      bytesScanned: 1024 ** 3,
      recordsMatched: 3,
      status: 'Complete',
    })
    await recordRun({
      query: QUERY,
      logGroups: ['/aws/lambda/a'],
      windowSeconds: 3600,
      bytesScanned: 12,
      recordsMatched: 0,
      status: 'Cancelled',
    })
    await expect(lastBytesFor(QUERY)).resolves.toBe(1024 ** 3)
  })

  it('câu chưa từng lưu vẫn có số đo qua lịch sử (chỉ lấy lần Complete)', async () => {
    await recordRun({
      query: QUERY,
      logGroups: ['/aws/lambda/a'],
      windowSeconds: 3600,
      bytesScanned: 12,
      recordsMatched: 0,
      status: 'Cancelled',
    })
    await expect(lastBytesFor(QUERY)).resolves.toBeUndefined()
    await recordRun({
      query: QUERY,
      logGroups: ['/aws/lambda/a'],
      windowSeconds: 3600,
      bytesScanned: 4096,
      recordsMatched: 1,
      status: 'Complete',
    })
    await expect(lastBytesFor(QUERY)).resolves.toBe(4096)
  })

  it('lịch sử là vòng quay: vượt trần thì cũ nhất bị đẩy ra, không phải lỗi', async () => {
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      await recordRun({
        query: `${QUERY} | limit ${String(i + 1)}`,
        logGroups: ['/aws/lambda/a'],
        windowSeconds: 3600,
        bytesScanned: i,
        recordsMatched: 1,
        status: 'Complete',
      })
    }
    const library = await readLibrary()
    expect(library.history).toHaveLength(MAX_HISTORY)
  })

  it('dọn lịch sử trả về số dòng đã xoá', async () => {
    await recordRun({
      query: QUERY,
      logGroups: ['/aws/lambda/a'],
      windowSeconds: 3600,
      bytesScanned: 1,
      recordsMatched: 1,
      status: 'Complete',
    })
    await expect(clearHistory()).resolves.toEqual({ removed: 1 })
    const library = await readLibrary()
    expect(library.history).toHaveLength(0)
  })
})

describe('quyền trên đĩa', () => {
  it('thư mục 0700 và file 0600 — hàng rào thật cho một file ghi được', async () => {
    await saveQuery({
      name: 'A',
      query: QUERY,
      logGroups: ['/aws/lambda/a'],
      windowSeconds: 3600,
    })
    const dirMode = (await stat(logsLibraryDir())).mode & 0o777
    const fileMode = (await stat(logsLibraryFile())).mode & 0o777
    expect(dirMode).toBe(0o700)
    expect(fileMode).toBe(0o600)
    // Nội dung trên đĩa không chứa giá trị secret nào — chỉ câu query và tên group.
    const raw = await readFile(logsLibraryFile(), 'utf8')
    expect(raw).toContain('/aws/lambda/a')
  })
})
