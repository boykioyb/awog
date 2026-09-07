// Resolver là thứ phân biệt chỉ mục này với grep. Ba ca dưới đây là ba chỗ grep
// mù hoàn toàn: đuôi `.js` của NodeNext, `index.ts` gọi bằng tên thư mục, và
// alias `~/` không có đường dẫn tương đối nào để lần theo.
//
// Run: npx vitest run src/codeindex/__tests__/resolver.test.ts
import { describe, expect, it } from 'vitest'
import { createResolver } from '../resolver.js'

const FILES = [
  'src/a/one.ts',
  'src/a/two.ts',
  'src/b/index.ts',
  'src/c/thing.vue',
  'apps/ui/composables/useTheme.ts',
  'apps/ui/pages/home.vue',
  'packages/lib/composables/useTheme.ts',
]

const r = createResolver(FILES)

describe('createResolver', () => {
  it('giải đuôi .js của NodeNext về file .ts thật', () => {
    expect(r.resolve('src/a/one.ts', './two.js')).toBe('src/a/two.ts')
  })

  it('giải import tương đối không có đuôi', () => {
    expect(r.resolve('src/a/one.ts', './two')).toBe('src/a/two.ts')
    expect(r.resolve('src/a/one.ts', '../b/index.js')).toBe('src/b/index.ts')
  })

  it('giải thư mục về index.ts', () => {
    expect(r.resolve('src/a/one.ts', '../b')).toBe('src/b/index.ts')
  })

  it('giải file .vue', () => {
    expect(r.resolve('src/a/one.ts', '../c/thing.vue')).toBe('src/c/thing.vue')
  })

  it('giải alias ~/ và @/ bằng khớp đuôi', () => {
    expect(r.resolve('apps/ui/pages/home.vue', '~/pages/home.vue')).toBe('apps/ui/pages/home.vue')
  })

  it('KHÔNG đoán khi đuôi khớp nhiều file — một cạnh sai tệ hơn một cạnh thiếu', () => {
    // 'composables/useTheme' tồn tại ở cả apps/ui lẫn packages/lib.
    expect(r.resolve('apps/ui/pages/home.vue', '~/composables/useTheme')).toBeNull()
  })

  it('coi specifier trần của package là ngoài repo', () => {
    expect(r.resolve('src/a/one.ts', 'zod')).toBeNull()
    expect(r.resolve('src/a/one.ts', 'node:fs')).toBeNull()
    expect(r.resolve('src/a/one.ts', '#imports')).toBeNull()
  })

  it('trả null cho import tương đối trỏ ra ngoài tập đã lập chỉ mục', () => {
    expect(r.resolve('src/a/one.ts', '../../outside/x.js')).toBeNull()
  })
})
