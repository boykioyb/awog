// Ba câu hỏi chỉ mục trả lời, và chỉ ba: định nghĩa ở đâu, ai gọi, sửa file này
// thì vỡ gì. Mọi câu trả lời là `path:line` + một dòng trích — KHÔNG bao giờ cả
// file: thứ làm hỏng một lượt chat không phải câu hỏi sai mà là câu trả lời quá
// dài.
//
// Đoạn trích được ĐỌC LẠI TỪ ĐĨA lúc truy vấn chứ không lưu trong chỉ mục. Hai
// cái lợi: chỉ mục nhỏ đi nhiều lần, và đoạn trích không bao giờ cũ so với file
// thật (nếu file đã đổi, số dòng có thể lệch — và ta thấy ngay vì dòng đọc được
// không còn chứa tên đang tìm).

import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import type { CodeDecl, CodeFileIndex, CodeIndex, DeclKind } from './types.js'

// Số file giữ trong bộ nhớ đệm dòng cho MỘT truy vấn.
const LINE_CACHE_FILES = 120
const EXCERPT_MAX_CHARS = 200

export const MAX_DEF_HITS = 30
export const MAX_REF_HITS = 60
export const MAX_BLAST_FILES = 200
export const MAX_BLAST_DEPTH = 4

export interface DefHit {
  path: string
  line: number
  kind: DeclKind
  exported: boolean
  container?: string | undefined
  excerpt: string
}

export interface RefHit {
  path: string
  line: number
  excerpt: string
}

export interface DefResult {
  hits: DefHit[]
  total: number
  // Khi không khớp chính xác: các tên gần giống có trong chỉ mục.
  suggestions: string[]
}

export interface RefResult {
  hits: RefHit[]
  total: number
  files: number
  // Nơi symbol được KHAI BÁO — để model phân biệt "chỗ gọi" với "chỗ định nghĩa".
  definedAt: string[]
}

export interface BlastResult {
  path: string
  // File import trực tiếp file này.
  direct: string[]
  // File tới được qua chuỗi import, ở độ sâu 2..depth.
  transitive: string[]
  // File KHÔNG import nó nhưng có nhắc tới một symbol nó export. Đây là đường
  // duy nhất thấy được người dùng Nuxt auto-import (composable/component dùng
  // mà không có câu lệnh import nào).
  symbolUsers: string[]
  depth: number
  truncated: boolean
}

type LineReader = (path: string, line: number) => Promise<string>

function createLineReader(root: string): LineReader {
  const cache = new Map<string, string[] | null>()
  return async (path, line) => {
    let lines = cache.get(path)
    if (lines === undefined) {
      lines = null
      try {
        // Chỉ mục chỉ chứa đường dẫn tương đối do CHÍNH nó sinh ra, nhưng cổng
        // này vẫn phải đi qua: file trên đĩa là L1, và đây là chỗ duy nhất
        // module đọc thật (invariant #2).
        const abs = assertInsideWorkspace(root, path)
        lines = (await readFile(abs, 'utf8')).split('\n')
      } catch {
        lines = null
      }
      if (cache.size >= LINE_CACHE_FILES) cache.clear()
      cache.set(path, lines)
    }
    const text = lines?.[line - 1]
    if (text === undefined) return ''
    const trimmed = text.trim()
    return trimmed.length > EXCERPT_MAX_CHARS ? `${trimmed.slice(0, EXCERPT_MAX_CHARS)}…` : trimmed
  }
}

// Ưu tiên hiển thị: cái được export và cái "định nghĩa thật" lên trước.
const KIND_RANK: Record<DeclKind, number> = {
  function: 0,
  class: 0,
  method: 1,
  interface: 2,
  type: 2,
  enum: 2,
  const: 3,
}

function rank(decl: CodeDecl): number {
  return (decl.exported ? 0 : 10) + KIND_RANK[decl.kind]
}

// Tên gần giống: khác hoa/thường, hoặc chứa tên đã hỏi. Chỉ dùng khi khớp chính
// xác trả 0 kết quả — nói "không có, ý bạn là X?" hữu ích hơn nói "không có".
function suggestNames(index: CodeIndex, name: string): string[] {
  const lower = name.toLowerCase()
  const found = new Set<string>()
  for (const file of index.files) {
    for (const decl of file.decls) {
      if (found.size >= 8) return [...found]
      const candidate = decl.name.toLowerCase()
      if (candidate === lower || (name.length >= 4 && candidate.includes(lower))) {
        found.add(decl.name)
      }
    }
  }
  return [...found]
}

export async function findDefinitions(
  index: CodeIndex,
  name: string,
  opts: { pathFilter?: string | undefined } = {},
): Promise<DefResult> {
  const filter = opts.pathFilter
  const matches: { file: CodeFileIndex; decl: CodeDecl }[] = []
  for (const file of index.files) {
    if (filter && !file.path.includes(filter)) continue
    for (const decl of file.decls) {
      if (decl.name === name) matches.push({ file, decl })
    }
  }
  matches.sort(
    (a, b) => rank(a.decl) - rank(b.decl) || a.file.path.localeCompare(b.file.path) || a.decl.line - b.decl.line,
  )
  const readLine = createLineReader(index.root)
  const hits: DefHit[] = []
  for (const { file, decl } of matches.slice(0, MAX_DEF_HITS)) {
    hits.push({
      path: file.path,
      line: decl.line,
      kind: decl.kind,
      exported: decl.exported,
      container: decl.container,
      // eslint-disable-next-line no-await-in-loop
      excerpt: await readLine(file.path, decl.line),
    })
  }
  return {
    hits,
    total: matches.length,
    suggestions: matches.length === 0 ? suggestNames(index, name) : [],
  }
}

export async function findReferences(
  index: CodeIndex,
  name: string,
  opts: { pathFilter?: string | undefined } = {},
): Promise<RefResult> {
  const filter = opts.pathFilter
  const flat: { path: string; line: number }[] = []
  const definedAt: string[] = []
  let files = 0
  for (const file of index.files) {
    for (const decl of file.decls) {
      if (decl.name === name) definedAt.push(`${file.path}:${decl.line}`)
    }
    if (filter && !file.path.includes(filter)) continue
    const lines = file.refs[name]
    if (!lines || lines.length === 0) continue
    files++
    for (const line of lines) flat.push({ path: file.path, line })
  }
  const readLine = createLineReader(index.root)
  const hits: RefHit[] = []
  for (const hit of flat.slice(0, MAX_REF_HITS)) {
    // eslint-disable-next-line no-await-in-loop
    hits.push({ ...hit, excerpt: await readLine(hit.path, hit.line) })
  }
  return { hits, total: flat.length, files, definedAt: definedAt.slice(0, MAX_DEF_HITS) }
}

// Chấp nhận đường dẫn tuyệt đối, tương đối so với root, hoặc một hậu tố duy nhất
// ('sessions/runner.ts'). Trả null khi không có / mơ hồ — không đoán.
export function resolveIndexedPath(index: CodeIndex, input: string): string | null {
  const raw = input.trim().replace(/\\/g, '/')
  if (raw.length === 0) return null
  const candidates: string[] = [raw.replace(/^\.\//, '')]
  if (raw.startsWith('/')) {
    const rel = relative(index.root, resolve(raw)).replace(/\\/g, '/')
    if (rel.length > 0 && !rel.startsWith('..')) candidates.unshift(rel)
  }
  for (const candidate of candidates) {
    if (index.files.some((f) => f.path === candidate)) return candidate
  }
  // Hậu tố duy nhất mới được chấp nhận; khớp nhiều file ⇒ hỏi lại còn hơn đoán.
  const suffix = candidates[0]
  const tail = index.files.filter((f) => f.path.endsWith(`/${suffix}`))
  return tail.length === 1 ? tail[0].path : null
}

export function blastRadius(index: CodeIndex, path: string, depth: number): BlastResult {
  const wanted = Math.min(Math.max(1, Math.floor(depth)), MAX_BLAST_DEPTH)
  // Cạnh ngược: file → những file import nó.
  const importedBy = new Map<string, string[]>()
  for (const file of index.files) {
    for (const imp of file.imports) {
      if (!imp.target) continue
      const bucket = importedBy.get(imp.target)
      if (bucket) {
        if (!bucket.includes(file.path)) bucket.push(file.path)
      } else importedBy.set(imp.target, [file.path])
    }
  }

  const seen = new Set<string>([path])
  const direct: string[] = []
  const transitive: string[] = []
  let frontier = [path]
  let truncated = false
  for (let level = 1; level <= wanted; level++) {
    const next: string[] = []
    for (const node of frontier) {
      for (const parent of importedBy.get(node) ?? []) {
        if (seen.has(parent)) continue
        seen.add(parent)
        if (seen.size > MAX_BLAST_FILES) {
          truncated = true
          break
        }
        next.push(parent)
        if (level === 1) direct.push(parent)
        else transitive.push(parent)
      }
      if (truncated) break
    }
    if (truncated || next.length === 0) break
    frontier = next
  }

  // Người dùng qua auto-import: không có cạnh import nào, nhưng có nhắc tên
  // symbol mà file này export.
  const self = index.files.find((f) => f.path === path)
  const exported = new Set(self?.decls.filter((d) => d.exported).map((d) => d.name) ?? [])
  const symbolUsers: string[] = []
  if (exported.size > 0) {
    for (const file of index.files) {
      if (seen.has(file.path)) continue
      for (const name of Object.keys(file.refs)) {
        if (!exported.has(name)) continue
        symbolUsers.push(file.path)
        break
      }
      if (symbolUsers.length >= MAX_BLAST_FILES) {
        truncated = true
        break
      }
    }
  }

  direct.sort()
  transitive.sort()
  symbolUsers.sort()
  return { path, direct, transitive, symbolUsers, depth: wanted, truncated }
}
