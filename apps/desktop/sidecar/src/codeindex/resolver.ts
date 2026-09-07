// Nối specifier import với file thật trong repo.
//
// Ba việc grep không làm được, và là lý do module này tồn tại:
//   1. Repo dùng NodeNext ⇒ import viết `./store.js` nhưng file là `store.ts`.
//   2. Nuxt/Vite dùng alias `~/`, `@/` ⇒ không có đường dẫn tương đối nào để lần.
//   3. `index.ts` được import bằng tên thư mục.
//
// Alias được giải bằng KHỚP ĐUÔI trên tập file đã lập chỉ mục thay vì đọc
// tsconfig `paths`: repo là monorepo nhiều tsconfig lồng nhau, và đuôi đường dẫn
// (`composables/useTheme`) trong thực tế là duy nhất. Khi KHÔNG duy nhất, ta trả
// null (không resolve) chứ không đoán bừa — đoán sai ở đây đẻ ra cạnh đồ thị ma,
// mà một cạnh ma trong "blast radius" thì tệ hơn một cạnh thiếu.

import { dirname, normalize } from 'node:path/posix'

// Thứ tự thử đuôi file. `.ts` trước `.js` vì repo là TypeScript.
const EXTS = ['.ts', '.tsx', '.mts', '.cts', '.vue', '.js', '.jsx', '.mjs', '.cjs'] as const

// Đuôi mà TypeScript bảo viết trong import nhưng KHÔNG tồn tại trên đĩa.
const JS_TO_TS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
}

const ALIAS_PREFIXES = ['~~/', '@@/', '~/', '@/'] as const

function stripExt(path: string): string {
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  return dot > slash ? path.slice(0, dot) : path
}

// Khoá module của một file: bỏ đuôi, và `a/b/index` cho thêm khoá `a/b`.
function moduleKeys(path: string): string[] {
  const base = stripExt(path)
  const keys = [base]
  if (base.endsWith('/index')) keys.push(base.slice(0, -'/index'.length))
  return keys
}

// Mọi hậu tố của khoá, cắt tại ranh giới thư mục — để khớp alias.
function suffixes(key: string): string[] {
  const parts = key.split('/')
  const out: string[] = []
  for (let i = 0; i < parts.length; i++) out.push(parts.slice(i).join('/'))
  return out
}

export interface ImportResolver {
  // Trả về đường dẫn tương đối trong repo, hoặc null (external / không resolve
  // được / đuôi khớp nhiều file).
  resolve(fromPath: string, spec: string): string | null
}

export function createResolver(paths: readonly string[]): ImportResolver {
  const files = new Set(paths)
  const bySuffix = new Map<string, string[]>()
  for (const path of paths) {
    for (const key of moduleKeys(path)) {
      for (const suffix of suffixes(key)) {
        const bucket = bySuffix.get(suffix)
        if (bucket) bucket.push(path)
        else bySuffix.set(suffix, [path])
      }
    }
  }

  // Thử `base`, `base+ext`, `base/index+ext` theo đúng thứ tự Node/Vite dùng.
  const tryBase = (base: string): string | null => {
    if (files.has(base)) return base
    const dot = base.lastIndexOf('.')
    const slash = base.lastIndexOf('/')
    if (dot > slash) {
      const rewrites = JS_TO_TS[base.slice(dot)]
      if (rewrites) {
        for (const ext of rewrites) {
          const candidate = base.slice(0, dot) + ext
          if (files.has(candidate)) return candidate
        }
      }
    }
    for (const ext of EXTS) {
      if (files.has(base + ext)) return base + ext
    }
    for (const ext of EXTS) {
      if (files.has(`${base}/index${ext}`)) return `${base}/index${ext}`
    }
    return null
  }

  return {
    resolve(fromPath, spec) {
      if (spec.length === 0) return null
      if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
        const base = normalize(`${dirname(fromPath)}/${spec}`)
        // normalize có thể để lại './' hoặc đẩy ra ngoài gốc repo — cả hai đều
        // không thể là file đã lập chỉ mục, tryBase sẽ trả null.
        return tryBase(base.startsWith('./') ? base.slice(2) : base)
      }
      for (const prefix of ALIAS_PREFIXES) {
        if (!spec.startsWith(prefix)) continue
        const sub = spec.slice(prefix.length)
        const direct = tryBase(sub)
        if (direct) return direct
        const hits = bySuffix.get(stripExt(sub))
        // Không duy nhất ⇒ không đoán. Một cạnh sai tệ hơn một cạnh thiếu.
        return hits && hits.length === 1 ? hits[0] : null
      }
      return null // specifier trần của package, hoặc module ảo (#imports)
    },
  }
}
