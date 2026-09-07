// Bề mặt model nhìn thấy. Kiểm ở đây không phải "tìm đúng không" (parser.test /
// index-build.test lo rồi) mà là: câu trả lời có nói THẬT về giới hạn của nó
// không. Một tool tra cứu trả "không thấy" mà nghe như "không tồn tại" sẽ khiến
// model xoá code còn sống.
//
// Run: npx vitest run src/codeindex/__tests__/code-index-tool.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodeIndexTool } from '../../runtime/tools/code-index-tool.js'
import { resetIndexMemo } from '../build.js'

let repo = ''
let base = ''
let realHome: string | undefined

// Lấy đúng kiểu tham số của tool thay vì ép kiểu — nếu schema đổi, test vỡ ở
// bước typecheck chứ không im lặng chạy sai.
type ToolParams = Parameters<ReturnType<typeof createCodeIndexTool>['execute']>[1]

const run = async (params: ToolParams): Promise<string> => {
  const res = await createCodeIndexTool(repo).execute('call-1', params)
  const first = res.content[0]
  return first && first.type === 'text' ? first.text : ''
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'awog-codeindex-tool-'))
  repo = join(base, 'repo')
  realHome = process.env.HOME
  process.env.HOME = join(base, 'home')
  await mkdir(join(repo, 'src'), { recursive: true })
  await mkdir(join(base, 'home'), { recursive: true })
  await writeFile(
    join(repo, 'src/lib.ts'),
    'export function widget(n: number) {\n  return n\n}\n',
    'utf8',
  )
  await writeFile(
    join(repo, 'src/use.ts'),
    ["import { widget } from './lib.js'", 'export const out = widget(1)', ''].join('\n'),
    'utf8',
  )
  resetIndexMemo()
})

afterAll(async () => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  if (base) await rm(base, { recursive: true, force: true })
})

describe('code_index tool', () => {
  it('define trả path:line kèm một dòng ngữ cảnh, không trả cả file', async () => {
    const text = await run({ action: 'define', symbol: 'widget' })
    expect(text).toContain('src/lib.ts:1')
    expect(text).toContain('export function widget')
    expect(text).not.toContain('return n')
  })

  it('refs phân biệt nơi gọi với nơi khai báo', async () => {
    const text = await run({ action: 'refs', symbol: 'widget' })
    expect(text).toContain('src/use.ts:2')
    expect(text).toContain('declared at src/lib.ts:1')
  })

  it('blast đi theo cạnh import đã resolve từ đuôi .js', async () => {
    const text = await run({ action: 'blast', path: 'src/lib.ts' })
    expect(text).toContain('imported directly by')
    expect(text).toContain('src/use.ts')
  })

  it('KHÔNG khẳng định symbol không tồn tại — chỉ nói chỉ mục không có bản ghi', async () => {
    const text = await run({ action: 'refs', symbol: 'khongCoThat' })
    expect(text).toContain('No indexed reference')
    expect(text).toMatch(/Grep/)
  })

  it('gợi ý tên gần giống thay vì im lặng', async () => {
    const text = await run({ action: 'define', symbol: 'Widget' })
    expect(text).toContain('widget')
  })

  it('báo lỗi rõ ràng khi thiếu tham số bắt buộc', async () => {
    const missingSymbol = await run({ action: 'define' })
    expect(missingSymbol).toContain('needs `symbol`')
    const missingPath = await run({ action: 'blast' })
    expect(missingPath).toContain('needs `path`')
  })

  it('status báo độ phủ và cách liệt kê file', async () => {
    const text = await run({ action: 'status' })
    expect(text).toContain('2 source files')
    expect(text).toContain('listed via walk')
    // Không phải repo git ⇒ phải nói rõ .gitignore không được áp dụng.
    expect(text).toContain('.gitignore was not applied')
  })
})
