// Parser là chỗ chỉ mục có thể nói dối. Mỗi ca ở đây hoặc chốt một thứ nó PHẢI
// thấy, hoặc chốt một thứ nó PHẢI KHÔNG thấy (khai báo ma sinh từ chuỗi/chú
// thích) — hoặc ghi thành văn một giới hạn đã biết, để lần sau ai đó sửa parser
// còn biết mình đang phá vỡ điều gì.
//
// Run: npx vitest run src/codeindex/__tests__/parser.test.ts
import { describe, expect, it } from 'vitest'
import { parseImportClause, parseSource } from '../parser.js'

const declOf = (src: string, name: string) =>
  parseSource(src, 'a.ts').decls.find((d) => d.name === name)

describe('khai báo', () => {
  it('bắt được hàm, class, interface, type, enum, const', () => {
    const src = [
      'export function alpha() {}',
      'function beta() {}',
      'export class Gamma {}',
      'export interface Delta { x: number }',
      'export type Epsilon = string',
      'export enum Zeta { A }',
      'export const eta = 3',
      'const theta = (x: number) => x',
    ].join('\n')
    const { decls } = parseSource(src, 'a.ts')
    const byName = new Map(decls.map((d) => [d.name, d]))
    expect(byName.get('alpha')).toMatchObject({ kind: 'function', exported: true, line: 1 })
    expect(byName.get('beta')).toMatchObject({ kind: 'function', exported: false, line: 2 })
    expect(byName.get('Gamma')).toMatchObject({ kind: 'class', exported: true })
    expect(byName.get('Delta')).toMatchObject({ kind: 'interface', exported: true })
    expect(byName.get('Epsilon')).toMatchObject({ kind: 'type', exported: true })
    expect(byName.get('Zeta')).toMatchObject({ kind: 'enum', exported: true })
    expect(byName.get('eta')).toMatchObject({ kind: 'const', exported: true })
    // const gán hàm mũi tên được xếp là 'function' — đó là thứ người ta đi tìm.
    expect(byName.get('theta')).toMatchObject({ kind: 'function', exported: false })
  })

  it('bắt phương thức trong class kèm tên class chứa nó', () => {
    const src = [
      'export class Runner {',
      '  private state = 1',
      '  async start(id: string) {',
      '    if (this.state) { return }',
      '  }',
      '  handle = async (x: number) => x',
      '}',
    ].join('\n')
    const { decls } = parseSource(src, 'a.ts')
    expect(decls.find((d) => d.name === 'start')).toMatchObject({
      kind: 'method',
      container: 'Runner',
      line: 3,
    })
    expect(decls.find((d) => d.name === 'handle')).toMatchObject({ kind: 'method', container: 'Runner' })
    // `if (…)` bên trong thân phương thức KHÔNG được nhận nhầm là phương thức.
    expect(decls.some((d) => d.name === 'if')).toBe(false)
  })

  it('KHÔNG đẻ khai báo ma từ mã ví dụ nằm trong chuỗi hay chú thích', () => {
    const src = [
      'const prompt = `Gọi hàm như sau: function ghostOne() {}`',
      "const other = 'export class GhostTwo {}'",
      '// export function ghostThree() {}',
      '/* export interface GhostFour {} */',
    ].join('\n')
    const { decls } = parseSource(src, 'a.ts')
    const names = decls.map((d) => d.name)
    expect(names).not.toContain('ghostOne')
    expect(names).not.toContain('GhostTwo')
    expect(names).not.toContain('ghostThree')
    expect(names).not.toContain('GhostFour')
  })

  it('`export { x }` đánh dấu khai báo đã có là exported', () => {
    const { decls } = parseSource('function inner() {}\nexport { inner }\n', 'a.ts')
    expect(declOf('function inner() {}\nexport { inner }\n', 'inner')).toBeDefined()
    expect(decls.find((d) => d.name === 'inner')?.exported).toBe(true)
  })

  it('GIỚI HẠN ĐÃ BIẾT: destructuring không sinh khai báo', () => {
    const { decls } = parseSource('const { alpha, beta } = require("x")\n', 'a.ts')
    expect(decls.map((d) => d.name)).not.toContain('alpha')
  })
})

describe('import', () => {
  it('đọc được specifier của mọi dạng import', () => {
    const src = [
      "import { a, b as c } from './rel.js'",
      "import type { T } from '~/types'",
      "import def from 'pkg'",
      "import * as ns from 'node:fs'",
      "import './side-effect.js'",
      "export { x } from './reexport.js'",
      "export * from './star.js'",
      "const lazy = await import('./dyn.js')",
    ].join('\n')
    const { imports } = parseSource(src, 'a.ts')
    const specs = imports.map((i) => i.spec)
    expect(specs).toEqual(
      expect.arrayContaining([
        './rel.js',
        '~/types',
        'pkg',
        'node:fs',
        './side-effect.js',
        './reexport.js',
        './star.js',
        './dyn.js',
      ]),
    )
    expect(imports.find((i) => i.spec === './rel.js')?.names).toEqual(['a', 'b'])
    expect(imports.find((i) => i.spec === 'pkg')?.external).toBe(true)
    expect(imports.find((i) => i.spec === '~/types')?.external).toBe(false)
    expect(imports.find((i) => i.spec === './reexport.js')?.kind).toBe('reexport')
    expect(imports.find((i) => i.spec === './dyn.js')?.kind).toBe('dynamic')
  })

  it('KHÔNG nhặt câu import viết trong một chuỗi', () => {
    const { imports } = parseSource("const doc = `import x from 'ghost-pkg'`\n", 'a.ts')
    expect(imports.map((i) => i.spec)).not.toContain('ghost-pkg')
  })
})

describe('parseImportClause', () => {
  it('tách mệnh đề import thành tên cục bộ', () => {
    expect(parseImportClause('{ a, b as c }')).toEqual(['a', 'b'])
    expect(parseImportClause('Def, { a }')).toEqual(['a', 'default'])
    expect(parseImportClause('* as ns')).toEqual(['*'])
    expect(parseImportClause('Def')).toEqual(['default'])
  })
})

describe('tham chiếu', () => {
  it('ghi nơi gọi kèm số dòng, bỏ qua từ khoá điều khiển', () => {
    const src = ['function target() {}', 'if (true) {', '  target()', '}', 'other.target()'].join('\n')
    const { refs } = parseSource(src, 'a.ts')
    expect(refs.target).toEqual([3, 5])
    expect(refs.if).toBeUndefined()
  })

  it('không tính dòng khai báo là nơi gọi', () => {
    const { refs } = parseSource('export function solo() {}\n', 'a.ts')
    expect(refs.solo).toBeUndefined()
  })

  it('bỏ phương thức có sẵn khi gọi dạng thành viên, nhưng giữ lời gọi trần cùng tên', () => {
    const { refs } = parseSource('list.map(f)\nmap(other)\n', 'a.ts')
    expect(refs.map).toEqual([2])
  })
})

describe('Vue SFC', () => {
  const sfc = [
    '<template>',
    '  <SessionList :items="rows" />',
    '</template>',
    '',
    '<script setup lang="ts">',
    "import { useTheme } from '~/composables/useTheme'",
    'const rows = compute()',
    '</script>',
  ].join('\n')

  it('chỉ đọc khối <script> nhưng vẫn giữ đúng số dòng của cả file', () => {
    const { decls, imports } = parseSource(sfc, 'components/X.vue')
    expect(decls.find((d) => d.name === 'rows')?.line).toBe(7)
    expect(imports[0]).toMatchObject({ spec: '~/composables/useTheme', line: 6 })
  })

  it('ghi thẻ component trong <template> — đường duy nhất thấy được auto-import', () => {
    const { refs } = parseSource(sfc, 'components/X.vue')
    expect(refs.SessionList).toEqual([2])
  })
})
