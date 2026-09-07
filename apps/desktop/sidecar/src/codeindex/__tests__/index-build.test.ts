// Kiểm cả đường: đi bộ cây → parse → resolve import → lưu/nạp → truy vấn.
//
// Hai thứ đáng kiểm nhất ở đây KHÔNG phải "tìm thấy hàm": đó là (1) lần dựng thứ
// hai TÁI DÙNG file không đổi — nếu hỏng, mọi lượt chat trả tiền cho một lần quét
// toàn bộ; và (2) chỉ mục TỪ CHỐI thư mục nhà — session không gắn project chạy với
// cwd = homedir, và ở đó "quét toàn bộ mã nguồn" là hàng trăm nghìn file.
//
// Run: npx vitest run src/codeindex/__tests__/index-build.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureIndex, resetIndexMemo } from '../build.js'
import { blastRadius, findDefinitions, findReferences, resolveIndexedPath } from '../query.js'
import { loadIndex } from '../store.js'

let repo = ''
let fakeHome = ''
let realHome: string | undefined

async function write(rel: string, body: string): Promise<void> {
  const abs = join(repo, rel)
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, body, 'utf8')
}

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'awog-codeindex-'))
  repo = join(base, 'repo')
  fakeHome = join(base, 'home')
  await mkdir(repo, { recursive: true })
  await mkdir(fakeHome, { recursive: true })
  // Chỉ mục được ghi vào awogHome(); trỏ HOME vào thư mục tạm để test không rơi
  // rác vào ~/.awog của người đang chạy nó.
  realHome = process.env.HOME
  process.env.HOME = fakeHome

  await write(
    'src/core/engine.ts',
    [
      'export function runEngine(id: string) {',
      '  return prepare(id)',
      '}',
      'function prepare(id: string) {',
      '  return id',
      '}',
      'export class Engine {',
      '  start() {',
      '    return runEngine("x")',
      '  }',
      '}',
    ].join('\n'),
  )
  await write(
    'src/core/index.ts',
    ["export { runEngine } from './engine.js'", ''].join('\n'),
  )
  await write(
    'src/app/caller.ts',
    [
      "import { runEngine } from '../core/engine.js'",
      'export function boot() {',
      '  return runEngine("boot")',
      '}',
    ].join('\n'),
  )
  await write(
    'src/app/deep.ts',
    ["import { boot } from './caller.js'", 'export const go = () => boot()'].join('\n'),
  )
  // Không có câu lệnh import nào — mô phỏng Nuxt auto-import.
  await write(
    'src/ui/Panel.vue',
    [
      '<template>',
      '  <div>{{ runEngine }}</div>',
      '</template>',
      '<script setup lang="ts">',
      'const value = runEngine("auto")',
      '</script>',
    ].join('\n'),
  )
})

afterAll(async () => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  if (repo) await rm(join(repo, '..'), { recursive: true, force: true })
})

describe('ensureIndex', () => {
  it('lập chỉ mục cây không phải repo git bằng cách đi bộ, rồi lưu ra đĩa', async () => {
    resetIndexMemo()
    const { index, result } = await ensureIndex(repo, { force: true })
    expect(result.source).toBe('walk')
    expect(index.files.map((f) => f.path).sort()).toEqual([
      'src/app/caller.ts',
      'src/app/deep.ts',
      'src/core/engine.ts',
      'src/core/index.ts',
      'src/ui/Panel.vue',
    ])
    const saved = await loadIndex(repo)
    expect(saved?.files.length).toBe(index.files.length)
  })

  it('lần dựng thứ hai TÁI DÙNG file không đổi và chỉ parse lại file đã sửa', async () => {
    resetIndexMemo()
    await ensureIndex(repo, { force: true })
    resetIndexMemo()
    const future = new Date(Date.now() + 5_000)
    // Giữ nguyên câu import — các ca blast radius phía dưới dựa vào cạnh này.
    await writeFile(
      join(repo, 'src/app/deep.ts'),
      ["import { boot } from './caller.js'", 'export const go = () => boot()', 'export const extra = 1', ''].join('\n'),
      'utf8',
    )
    await utimes(join(repo, 'src/app/deep.ts'), future, future)
    const { result } = await ensureIndex(repo)
    expect(result.parsed).toBe(1)
    expect(result.reused).toBe(4)
  })

  it('TỪ CHỐI lập chỉ mục thư mục nhà', async () => {
    await expect(ensureIndex(homedir())).rejects.toThrow(/home directory/i)
  })

  it('từ chối đường dẫn không tuyệt đối', async () => {
    await expect(ensureIndex('relative/path')).rejects.toThrow(/absolute/i)
  })
})

describe('truy vấn', () => {
  it('tìm định nghĩa kèm dòng và đoạn trích đọc lại từ đĩa', async () => {
    resetIndexMemo()
    const { index } = await ensureIndex(repo, { force: true })
    const res = await findDefinitions(index, 'runEngine')
    expect(res.hits[0]).toMatchObject({
      path: 'src/core/engine.ts',
      line: 1,
      kind: 'function',
      exported: true,
    })
    expect(res.hits[0].excerpt).toContain('export function runEngine')
  })

  it('gợi ý tên gần giống khi không khớp chính xác', async () => {
    resetIndexMemo()
    const { index } = await ensureIndex(repo)
    const res = await findDefinitions(index, 'runengine')
    expect(res.hits).toHaveLength(0)
    expect(res.suggestions).toContain('runEngine')
  })

  it('liệt kê nơi gọi qua nhiều file, kèm nơi khai báo', async () => {
    resetIndexMemo()
    const { index } = await ensureIndex(repo)
    const res = await findReferences(index, 'runEngine')
    const places = res.hits.map((h) => `${h.path}:${h.line}`)
    expect(places).toContain('src/app/caller.ts:3')
    expect(places).toContain('src/core/engine.ts:9')
    expect(res.definedAt).toContain('src/core/engine.ts:1')
  })

  it('blast radius đi theo cạnh import, kể cả đuôi .js của NodeNext', async () => {
    resetIndexMemo()
    const { index } = await ensureIndex(repo)
    const radius = blastRadius(index, 'src/core/engine.ts', 2)
    expect(radius.direct.sort()).toEqual(['src/app/caller.ts', 'src/core/index.ts'])
    expect(radius.transitive).toContain('src/app/deep.ts')
  })

  it('blast radius thấy được người dùng auto-import qua tên symbol', async () => {
    resetIndexMemo()
    const { index } = await ensureIndex(repo)
    const radius = blastRadius(index, 'src/core/engine.ts', 1)
    // Panel.vue không import gì cả — chỉ gọi runEngine.
    expect(radius.symbolUsers).toContain('src/ui/Panel.vue')
  })

  it('nhận đường dẫn tuyệt đối, tương đối, hoặc hậu tố duy nhất', async () => {
    resetIndexMemo()
    const { index } = await ensureIndex(repo)
    expect(resolveIndexedPath(index, 'src/core/engine.ts')).toBe('src/core/engine.ts')
    expect(resolveIndexedPath(index, join(repo, 'src/core/engine.ts'))).toBe('src/core/engine.ts')
    expect(resolveIndexedPath(index, 'core/engine.ts')).toBe('src/core/engine.ts')
    expect(resolveIndexedPath(index, 'nope/missing.ts')).toBeNull()
  })
})
