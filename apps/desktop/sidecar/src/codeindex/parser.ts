// Parser "đủ dùng" cho TypeScript / JavaScript / Vue SFC.
//
// CỐ Ý KHÔNG dùng TypeScript compiler API. `typescript` có trong devDependencies
// nhưng kéo nó vào runtime sidecar là một quyết định nặng (thêm ~8 MB vào bundle,
// thêm một API khổng lồ vào đường nóng của mọi lượt chat) và cần ADR. Đổi lại,
// module này chỉ dựa vào việc che chuỗi/chú thích (mask.ts) + regex + đếm ngoặc
// có giới hạn.
//
// Hệ quả: chỉ mục ĐÚNG KHOẢNG 85%. Chỗ nó sai được liệt kê hết trong
// docs/features/code-index.md và được nói thẳng trong mô tả tool. Nguyên tắc:
// một chỉ mục biết mình mù ở đâu thì dùng được; một chỉ mục giả vờ chính xác thì
// nguy hiểm hơn không có gì.

import {
  MAX_DECLS_PER_FILE,
  MAX_REF_LINES_PER_NAME,
  MAX_REF_NAMES_PER_FILE,
  type CodeDecl,
  type CodeImport,
  type DeclKind,
} from './types.js'
import { lineAt, lineStarts, maskCode } from './mask.js'

export interface ParsedSource {
  decls: CodeDecl[]
  imports: CodeImport[]
  refs: Record<string, number[]>
  partial: boolean
}

// Từ khoá điều khiển: `if (`, `for (`… trông y hệt một lời gọi hàm sau khi che
// chuỗi, nên phải loại bằng danh sách chứ không bằng cú pháp.
const NON_CALL_WORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof', 'new',
  'await', 'do', 'with', 'in', 'of', 'case', 'delete', 'void', 'yield', 'super',
  'import', 'export', 'else', 'throw', 'instanceof', 'constructor', 'class',
  'extends', 'implements', 'as', 'satisfies', 'keyof', 'infer', 'is', 'asserts',
  'this', 'and', 'or', 'not',
])

// Tên toàn cục của ngôn ngữ/runtime. Chúng xuất hiện ở mọi file, không bao giờ là
// thứ ai đó hỏi "định nghĩa ở đâu", nên giữ chúng chỉ làm phình chỉ mục.
const GLOBAL_STOP = new Set([
  'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Date', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Error',
  'TypeError', 'RangeError', 'SyntaxError', 'RegExp', 'Proxy', 'Reflect',
  'BigInt', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'setTimeout',
  'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate',
  'queueMicrotask', 'structuredClone', 'encodeURIComponent',
  'decodeURIComponent', 'Buffer', 'process', 'globalThis', 'Intl',
  'TextEncoder', 'TextDecoder', 'String.raw',
])

// Phương thức có sẵn của Array/String/Promise/Map… Chỉ loại khi lời gọi ở dạng
// THÀNH VIÊN (`x.map(`): một hàm cục bộ tên `map` gọi trần `map(` vẫn được giữ.
// Đây là nguồn nhiễu lớn nhất của chỉ mục — bỏ nó đi cắt được phần lớn kích
// thước mà không mất thông tin nào ai từng hỏi.
const MEMBER_STOP = new Set([
  'push', 'pop', 'shift', 'unshift', 'map', 'filter', 'forEach', 'reduce',
  'slice', 'splice', 'join', 'concat', 'includes', 'indexOf', 'lastIndexOf',
  'find', 'findIndex', 'findLast', 'some', 'every', 'sort', 'reverse', 'flat',
  'flatMap', 'keys', 'values', 'entries', 'has', 'get', 'set', 'add', 'delete',
  'clear', 'trim', 'trimStart', 'trimEnd', 'split', 'replace', 'replaceAll',
  'startsWith', 'endsWith', 'toLowerCase', 'toUpperCase', 'padStart', 'padEnd',
  'repeat', 'charAt', 'charCodeAt', 'codePointAt', 'substring', 'match',
  'matchAll', 'search', 'test', 'exec', 'then', 'catch', 'finally', 'toString',
  'valueOf', 'toFixed', 'stringify', 'parse', 'log', 'warn', 'error', 'info',
  'debug', 'assign', 'freeze', 'from', 'of', 'isArray', 'now', 'floor', 'ceil',
  'round', 'abs', 'min', 'max', 'random', 'bind', 'call', 'apply', 'json',
  'text', 'at', 'localeCompare', 'toISOString', 'getTime',
])

const FUNCTION_RE =
  /(?<![\w$.])(export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g
const CLASS_RE =
  /(?<![\w$.])(export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g
const INTERFACE_RE = /(?<![\w$.])(export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/g
const TYPE_RE = /(?<![\w$.])(export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*[<=]/g
const ENUM_RE = /(?<![\w$.])(export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/g
const VAR_RE =
  /(?<![\w$.])(export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/g

const REF_RE = /([A-Za-z_$][\w$]*)\s*(?:<[^<>()]{0,80}>)?\s*\(/g

// Thành viên của class ở ĐỘ SÂU 1 trong thân class. Hai dạng: phương thức thật
// (`name(`) và thuộc tính arrow (`name = (…) =>`).
const MEMBER_RE =
  /^\s*(?:(?:public|private|protected|readonly|static|abstract|override|declare|async|get|set)\s+)*\*?\s*#?([A-Za-z_$][\w$]*)\s*\??\s*(?:<[^<>]{0,80}>)?\s*\(/
const MEMBER_ARROW_RE =
  /^\s*(?:(?:public|private|protected|readonly|static|abstract|override|declare)\s+)*#?([A-Za-z_$][\w$]*)\s*(?::[^=]{0,120})?=\s*(?:async\s*)?\(/

// Mệnh đề import ĐƯỢC xuống dòng (danh sách tên nhiều dòng) nhưng KHÔNG bao giờ
// chứa dấu nháy hay `;`. Không loại nháy ra khỏi tập ký tự thì một `import 'x'`
// (không có `from`) sẽ nuốt sang tận câu lệnh SAU và gán nhầm specifier của nó.
const IMPORT_RE = /(?<![\w$.])import\s+(?:type\s+)?([^;'"`]{0,400}?)\s*from\s*(['"])/g
const BARE_IMPORT_RE = /(?<![\w$.])import\s*(['"])/g
const DYNAMIC_IMPORT_RE = /(?<![\w$.])import\s*\(\s*(['"])/g
const REQUIRE_RE = /(?<![\w$.])require\s*\(\s*(['"])/g
const EXPORT_BRACE_RE = /(?<![\w$.])export\s+(?:type\s+)?\{([^}]{0,600})\}(\s*from\s*(['"]))?/g
const EXPORT_STAR_RE =
  /(?<![\w$.])export\s+\*(?:\s+as\s+[A-Za-z_$][\w$]*)?\s*from\s*(['"])/g

// Thẻ component trong <template> của Vue: `<AgentDetail`, `<SessionList`. Đây là
// cách duy nhất thấy được "component này dùng ở đâu" khi Nuxt auto-import (không
// có câu lệnh import nào để lần theo).
const VUE_TAG_RE = /<([A-Z][A-Za-z0-9_]*)/g

// Một `<script>` của Vue SFC: [đầu nội dung, cuối nội dung).
function vueScriptRegions(src: string): [number, number][] {
  const regions: [number, number][] = []
  const open = /<script\b[^>]*>/gi
  const lower = src.toLowerCase()
  let m: RegExpExecArray | null
  while ((m = open.exec(src)) !== null) {
    const start = m.index + m[0].length
    const close = lower.indexOf('</script>', start)
    const end = close === -1 ? src.length : close
    regions.push([start, end])
    open.lastIndex = end
  }
  return regions
}

// Giữ nguyên độ dài + xuống dòng, chỉ để lại phần trong `regions`. Nhờ vậy mọi
// offset khớp trên chuỗi kết quả vẫn quy ra đúng số dòng của file .vue gốc.
function keepOnly(src: string, regions: [number, number][]): string {
  if (regions.length === 0) return src.replace(/[^\n]/g, ' ')
  let out = ''
  let pos = 0
  for (const [start, end] of regions) {
    out += src.slice(pos, start).replace(/[^\n]/g, ' ')
    out += src.slice(start, end)
    pos = end
  }
  out += src.slice(pos).replace(/[^\n]/g, ' ')
  return out
}

function isBareSpecifier(spec: string): boolean {
  if (spec.startsWith('.') || spec.startsWith('/')) return false
  if (spec.startsWith('~') || spec.startsWith('@/') || spec.startsWith('@@/')) return false
  return true
}

// `Default, { a, b as c }` / `* as ns` → tên được mang vào.
export function parseImportClause(clause: string): string[] {
  const names: string[] = []
  const braced = clause.match(/\{([^}]*)\}/)
  if (braced) {
    for (const part of braced[1].split(',')) {
      const local = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
      if (local) names.push(local)
    }
  }
  const head = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim()
  if (/\*\s+as\s+[A-Za-z_$][\w$]*/.test(head)) names.push('*')
  const def = head.replace(/\*\s+as\s+[A-Za-z_$][\w$]*/, '').trim()
  if (/^[A-Za-z_$][\w$]*$/.test(def)) names.push('default')
  return names
}

// Danh sách trong `export { a, b as c }` → tên CỤC BỘ (vế trái).
function parseExportList(body: string): string[] {
  const names: string[] = []
  for (const part of body.split(',')) {
    const local = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
    if (local && local !== 'default') names.push(local)
  }
  return names
}

// Đọc lại specifier nguyên văn: `masked` đã xoá ruột chuỗi, nên giá trị thật nằm
// trong bảng `strings` do maskCode trả về, khoá bằng offset của dấu nháy MỞ.
function specAt(strings: Map<number, string>, quoteOffset: number): string | null {
  const value = strings.get(quoteOffset)
  return value !== undefined && value.length > 0 ? value : null
}

function collectImports(masked: string, strings: Map<number, string>, starts: number[]): CodeImport[] {
  const imports: CodeImport[] = []
  const push = (spec: string, offset: number, names: string[], kind: CodeImport['kind']): void => {
    imports.push({
      spec,
      line: lineAt(starts, offset),
      names,
      kind,
      external: isBareSpecifier(spec),
    })
  }

  let m: RegExpExecArray | null
  IMPORT_RE.lastIndex = 0
  while ((m = IMPORT_RE.exec(masked)) !== null) {
    const quoteOffset = m.index + m[0].length - 1
    const spec = specAt(strings, quoteOffset)
    if (spec) push(spec, m.index, parseImportClause(m[1]), 'import')
  }
  BARE_IMPORT_RE.lastIndex = 0
  while ((m = BARE_IMPORT_RE.exec(masked)) !== null) {
    const spec = specAt(strings, m.index + m[0].length - 1)
    if (spec) push(spec, m.index, [], 'import')
  }
  DYNAMIC_IMPORT_RE.lastIndex = 0
  while ((m = DYNAMIC_IMPORT_RE.exec(masked)) !== null) {
    const spec = specAt(strings, m.index + m[0].length - 1)
    if (spec) push(spec, m.index, [], 'dynamic')
  }
  REQUIRE_RE.lastIndex = 0
  while ((m = REQUIRE_RE.exec(masked)) !== null) {
    const spec = specAt(strings, m.index + m[0].length - 1)
    if (spec) push(spec, m.index, [], 'require')
  }
  EXPORT_BRACE_RE.lastIndex = 0
  while ((m = EXPORT_BRACE_RE.exec(masked)) !== null) {
    if (m[2] === undefined) continue // `export { a }` thuần — xử lý ở collectDecls
    const spec = specAt(strings, m.index + m[0].length - 1)
    if (spec) push(spec, m.index, parseExportList(m[1]), 'reexport')
  }
  EXPORT_STAR_RE.lastIndex = 0
  while ((m = EXPORT_STAR_RE.exec(masked)) !== null) {
    const spec = specAt(strings, m.index + m[0].length - 1)
    if (spec) push(spec, m.index, ['*'], 'reexport')
  }
  return imports
}

// Tìm dấu `{` mở thân class rồi dò ngoặc tìm dấu đóng. `cap` chặn việc quét vô
// hạn trên file cú pháp hỏng.
function classBody(masked: string, from: number): [number, number] | null {
  const open = masked.indexOf('{', from)
  if (open === -1 || open - from > 500) return null
  let depth = 0
  const limit = Math.min(masked.length, open + 400_000)
  for (let i = open; i < limit; i++) {
    const c = masked[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return [open, i]
    }
  }
  return null
}

// Phương thức ở độ sâu 1 trong thân class. Đi theo dòng và tự đếm ngoặc — đủ để
// phân biệt `foo() {}` (phương thức) với một `if (…)` lồng bên trong.
function collectMethods(
  masked: string,
  starts: number[],
  className: string,
  body: [number, number],
): CodeDecl[] {
  const decls: CodeDecl[] = []
  const [open, close] = body
  let depth = 1
  let p = open + 1
  while (p < close) {
    const nl = masked.indexOf('\n', p)
    const lineEnd = nl === -1 || nl > close ? close : nl
    const text = masked.slice(p, lineEnd)
    if (depth === 1) {
      const hit = MEMBER_RE.exec(text) ?? MEMBER_ARROW_RE.exec(text)
      const name = hit?.[1]
      if (name && !NON_CALL_WORDS.has(name)) {
        decls.push({ name, kind: 'method', line: lineAt(starts, p), exported: false, container: className })
      }
    }
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') depth--
    }
    p = lineEnd + 1
  }
  return decls
}

// Phía sau `=` là một hàm mũi tên / function expression? Quyết định kind của một
// `const`: `const run = () => …` là hàm, `const MAX = 10` là hằng.
function looksLikeFunctionValue(masked: string, afterDecl: number): boolean {
  const tail = masked.slice(afterDecl, afterDecl + 240)
  const eq = tail.indexOf('=')
  if (eq === -1) return false
  const rhs = tail.slice(eq + 1)
  if (/^\s*(?:async\s+)?function\b/.test(rhs)) return true
  return /^\s*(?:async\s*)?(?:\([^)]{0,200}\)|[A-Za-z_$][\w$]*)\s*(?::[^=>]{0,120})?=>/.test(rhs)
}

function collectDecls(masked: string, starts: number[]): { decls: CodeDecl[]; partial: boolean } {
  const decls: CodeDecl[] = []
  const simple: [RegExp, DeclKind][] = [
    [FUNCTION_RE, 'function'],
    [INTERFACE_RE, 'interface'],
    [TYPE_RE, 'type'],
    [ENUM_RE, 'enum'],
  ]
  for (const [re, kind] of simple) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(masked)) !== null) {
      decls.push({ name: m[2], kind, line: lineAt(starts, m.index), exported: m[1] !== undefined })
    }
  }

  CLASS_RE.lastIndex = 0
  let cm: RegExpExecArray | null
  while ((cm = CLASS_RE.exec(masked)) !== null) {
    const name = cm[2]
    decls.push({ name, kind: 'class', line: lineAt(starts, cm.index), exported: cm[1] !== undefined })
    const body = classBody(masked, cm.index + cm[0].length)
    if (body) decls.push(...collectMethods(masked, starts, name, body))
  }

  VAR_RE.lastIndex = 0
  let vm: RegExpExecArray | null
  while ((vm = VAR_RE.exec(masked)) !== null) {
    const kind: DeclKind = looksLikeFunctionValue(masked, vm.index + vm[0].length - 1)
      ? 'function'
      : 'const'
    decls.push({ name: vm[2], kind, line: lineAt(starts, vm.index), exported: vm[1] !== undefined })
  }

  // `export { a, b }` (không có `from`) đánh dấu khai báo đã có là exported.
  const exported = new Set<string>()
  EXPORT_BRACE_RE.lastIndex = 0
  let em: RegExpExecArray | null
  while ((em = EXPORT_BRACE_RE.exec(masked)) !== null) {
    if (em[2] !== undefined) continue
    for (const name of parseExportList(em[1])) exported.add(name)
  }
  for (const decl of decls) {
    if (exported.has(decl.name)) decl.exported = true
  }

  decls.sort((a, b) => a.line - b.line)
  const partial = decls.length > MAX_DECLS_PER_FILE
  return { decls: partial ? decls.slice(0, MAX_DECLS_PER_FILE) : decls, partial }
}

function collectRefs(
  masked: string,
  starts: number[],
  declLines: Set<string>,
): { refs: Record<string, number[]>; partial: boolean } {
  const refs: Record<string, number[]> = {}
  let partial = false
  REF_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = REF_RE.exec(masked)) !== null) {
    const name = m[1]
    if (name.length < 2) continue
    if (NON_CALL_WORDS.has(name) || GLOBAL_STOP.has(name)) continue
    const isMember = m.index > 0 && masked[m.index - 1] === '.'
    if (isMember && MEMBER_STOP.has(name)) continue
    const line = lineAt(starts, m.index)
    // Chính dòng khai báo của nó không phải là "nơi gọi".
    if (declLines.has(`${name}:${line}`)) continue
    const bucket = refs[name]
    if (bucket === undefined) {
      if (Object.keys(refs).length >= MAX_REF_NAMES_PER_FILE) {
        partial = true
        continue
      }
      refs[name] = [line]
      continue
    }
    if (bucket[bucket.length - 1] === line) continue
    if (bucket.length >= MAX_REF_LINES_PER_NAME) {
      partial = true
      continue
    }
    bucket.push(line)
  }
  return { refs, partial }
}

// `path` chỉ dùng để biết đây là .vue hay không.
export function parseSource(text: string, path: string): ParsedSource {
  const isVue = path.toLowerCase().endsWith('.vue')
  const starts = lineStarts(text)
  const regions = isVue ? vueScriptRegions(text) : null
  const scriptOnly = regions ? keepOnly(text, regions) : text
  const { masked, strings } = maskCode(scriptOnly)

  const { decls, partial: declsPartial } = collectDecls(masked, starts)
  const declLines = new Set(decls.map((d) => `${d.name}:${d.line}`))
  const { refs, partial: refsPartial } = collectRefs(masked, starts, declLines)
  const imports = collectImports(masked, strings, starts)

  if (isVue && regions) {
    // Thẻ component trong <template> — quét trên phần NGOÀI <script>.
    const templateOnly = keepOnly(
      text,
      invertRegions(regions, text.length).filter(([s, e]) => e > s),
    )
    VUE_TAG_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = VUE_TAG_RE.exec(templateOnly)) !== null) {
      const name = m[1]
      const line = lineAt(starts, m.index)
      const bucket = refs[name]
      if (bucket === undefined) {
        if (Object.keys(refs).length < MAX_REF_NAMES_PER_FILE) refs[name] = [line]
        continue
      }
      if (bucket[bucket.length - 1] !== line && bucket.length < MAX_REF_LINES_PER_NAME) {
        bucket.push(line)
      }
    }
  }

  return { decls, imports, refs, partial: declsPartial || refsPartial }
}

// Phần bù của một danh sách khoảng (đã sắp xếp, không chồng nhau).
function invertRegions(regions: [number, number][], length: number): [number, number][] {
  const out: [number, number][] = []
  let pos = 0
  for (const [start, end] of regions) {
    if (start > pos) out.push([pos, start])
    pos = end
  }
  if (pos < length) out.push([pos, length])
  return out
}
