// Che chuỗi/chú thích là nền móng của cả chỉ mục: nếu nó sai, mọi khai báo và
// tham chiếu phía sau đều sai theo. Hai bất biến được kiểm ở đây — ĐỘ DÀI không
// đổi và SỐ DÒNG không đổi — chính là thứ bảo đảm mọi offset khớp được quy ra
// đúng `path:line`.
//
// Run: npx vitest run src/codeindex/__tests__/mask.test.ts
import { describe, expect, it } from 'vitest'
import { lineAt, lineStarts, maskCode } from '../mask.js'

const masked = (src: string): string => maskCode(src).masked

describe('maskCode', () => {
  it('giữ nguyên độ dài và số dòng', () => {
    const src = `const a = 'xin chào'\n// chú thích\n/* nhiều\n   dòng */\nconst b = 1\n`
    const out = masked(src)
    expect(out.length).toBe(src.length)
    expect(out.split('\n').length).toBe(src.split('\n').length)
  })

  it('xoá ruột chuỗi nhưng giữ dấu nháy', () => {
    expect(masked(`const a = 'function foo('`)).toBe(`const a = '${' '.repeat('function foo('.length)}'`)
  })

  it('xoá chú thích một dòng và nhiều dòng', () => {
    expect(masked('a // function ghost()')).toBe('a                    ')
    expect(masked('a /* function ghost() */ b')).toBe('a                        b')
  })

  it('KHÔNG che biểu thức trong template literal — đó là mã thật', () => {
    const out = masked('const s = `xin ${greet(name)} chào`')
    expect(out).toContain('greet(name)')
    expect(out).not.toContain('chào')
  })

  it('xử lý template lồng nhau', () => {
    const out = masked('const s = `a ${ inner(`b ${deep(x)} c`) } d`')
    expect(out).toContain('inner(')
    expect(out).toContain('deep(x)')
    expect(out).not.toContain('d`')
  })

  it('che regex literal nhưng KHÔNG che phép chia', () => {
    expect(masked('const re = /foo(bar)/g')).toBe(`const re = /${' '.repeat('foo(bar)'.length)}/g`)
    // `a / b(c) / d` là phép chia — nếu bị nhầm thành regex thì lời gọi b() biến mất.
    expect(masked('const x = a / b(c) / d')).toContain('b(c)')
  })

  it('regex không đóng trên cùng dòng được coi là phép chia (hàng rào thiệt hại)', () => {
    const src = 'const x = a / b\nconst y = call(1)\n'
    expect(masked(src)).toContain('call(1)')
  })

  it('ghi lại nguyên văn chuỗi ngắn theo offset dấu nháy mở', () => {
    const src = `import { z } from 'zod'`
    const { strings } = maskCode(src)
    expect(strings.get(src.indexOf("'zod'"))).toBe('zod')
  })

  it('không chết vì chuỗi / template chưa đóng', () => {
    expect(() => maskCode('const a = "chưa đóng\nconst b = 1')).not.toThrow()
    expect(() => maskCode('const a = `chưa đóng')).not.toThrow()
  })

  it('coi một chuỗi không đóng là chỉ hết dòng đó', () => {
    const out = masked('const a = "hở\nconst b = call(1)\n')
    expect(out).toContain('call(1)')
  })
})

describe('lineAt', () => {
  it('quy offset về số dòng 1-based', () => {
    const src = 'a\nbb\nccc'
    const starts = lineStarts(src)
    expect(lineAt(starts, 0)).toBe(1)
    expect(lineAt(starts, 2)).toBe(2)
    expect(lineAt(starts, 5)).toBe(3)
    expect(lineAt(starts, src.length - 1)).toBe(3)
  })
})
