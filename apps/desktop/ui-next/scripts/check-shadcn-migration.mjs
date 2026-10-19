#!/usr/bin/env node
// Kiểm tra một file .vue đã "sạch" theo chuẩn 100% shadcn chưa
// (docs/coding/shadcn-migration.md). Dùng:
//   node scripts/check-shadcn-migration.mjs <file.vue|thư mục>...   → báo vi phạm từng file
//   node scripts/check-shadcn-migration.mjs --summary <dir>...       → chỉ in tổng số
// Exit 1 nếu còn vi phạm. Không sửa gì.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const LEGACY_CSS = ['assets/css/prototype.css', 'assets/css/app-shell.css']

// Class global của CSS cũ — dùng trong template = còn phụ thuộc skin cũ.
const legacyClasses = new Set()
for (const f of LEGACY_CSS) {
  const css = readFileSync(join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) legacyClasses.add(m[1])
}
// Trùng tên utility Tailwind / tên chung chung — không tính là skin cũ.
for (const c of [
  'light',
  'dark',
  'hidden',
  'flex',
  'grid',
  'block',
  'truncate',
  'sr-only',
  'on',
  'active',
  'open',
  'disabled',
  'compact',
  'icn',
  'tnum',
  'katex',
])
  legacyClasses.delete(c)

const RULES = [
  [
    'style-block',
    /<style\b(?![^>]*\bmodule\b)/g,
    'Còn <style> — dỡ sang Tailwind/shadcn (ngoại lệ: comment `style-ok:` trong block)',
  ],
  [
    'raw-control',
    /<(button|input|select)\b/g,
    'Control thô — dùng Button/Input/Select/Checkbox/Switch… (ngoại lệ: comment `raw-ok:` cùng dòng hoặc dòng trên)',
  ],
  [
    'var-color',
    /\b(?:bg|text|border|ring|fill|stroke|outline|from|to|via|decoration|divide|placeholder|caret|accent|shadow)-\((?:color:)?--[A-Za-z]/g,
    'Màu qua var thô `x-(--token)` — dùng utility ngữ nghĩa (bg-card, text-muted-foreground…)',
  ],
  [
    'var-color-legacy',
    /\b(?:bg|text|border|ring)-\[(?:color:)?var\(--/g,
    'Màu qua `x-[var(--token)]` — dùng utility ngữ nghĩa',
  ],
  ['hex', /(?<![\w&])#[0-9a-fA-F]{3,8}\b(?![\w-])/g, 'Hex cứng — dùng token theme'],
  ['use-theme', /\buseTheme\(\)/g, 'useTheme() để tô màu inline — dùng class Tailwind ngữ nghĩa'],
  [
    'inline-color-style',
    /:style="[^"]*\b(?:color|background|border)[^"]*\bt\.[a-zA-Z]/g,
    ':style tô màu từ token — dùng class',
  ],
  [
    'arbitrary-px',
    /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|h|w|min-h|min-w|max-h|max-w|size|top|left|right|bottom|inset|text|leading|rounded)-\[-?\d+(?:\.\d+)?px\]/g,
    'Giá trị px tự đặt — dùng thang Tailwind (p-2, h-ctrl…) hoặc comment `px-ok:`',
  ],
  [
    'cute-fork',
    /data-theme-family|useThemeFamily\(/g,
    'Rẽ nhánh theo theme family — Cute giờ chỉ là bộ màu',
  ],
]

function walk(p, out) {
  const st = statSync(p)
  if (st.isDirectory()) {
    for (const n of readdirSync(p))
      if (n !== 'node_modules' && !(p.endsWith('components') && n === 'ui')) walk(join(p, n), out)
  } else if (p.endsWith('.vue')) out.push(p)
  return out
}

// Khối comment `<!-- … -->` liền trên dòng mở thẻ chứa vị trí `idx` (tối đa 8 dòng).
function commentAboveTag(text, lines, idx) {
  const tagLn = lineOf(text, text.lastIndexOf('<', idx))
  let above = lines[tagLn - 1] ?? ''
  for (let i = tagLn - 2; i >= 0 && i >= tagLn - 8; i--) {
    above += lines[i]
    if (lines[i].includes('<!--')) break
  }
  return above
}

function lineOf(text, idx) {
  return text.slice(0, idx).split('\n').length
}

function check(file) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  const hits = []
  for (const [id, re, msg] of RULES) {
    for (const m of text.matchAll(re)) {
      const ln = lineOf(text, m.index)
      // Dòng hiện tại + dòng trên + khối comment liền trên dòng mở thẻ (thẻ nhiều dòng).
      const here = lines[ln - 1] ?? ''
      const prev = (lines[ln - 2] ?? '') + commentAboveTag(text, lines, m.index)
      if (id === 'style-block') {
        const block = text.slice(m.index, text.indexOf('</style>', m.index))
        if (/style-ok:/.test(block)) continue
      }
      if (id === 'raw-control' && /raw-ok:/.test(here + prev)) continue
      if (id === 'arbitrary-px' && /px-ok:/.test(here + prev)) continue
      // useTheme() chỉ để đọc/ghi trạng thái (isDark, accent, cỡ chữ) — không tô màu.
      if ((id === 'use-theme' || id === 'cute-fork') && /theme-ok:/.test(here + prev)) continue
      // Hex là DỮ LIỆU (bảng màu người dùng chọn, màu entity, CSS trong iframe sandbox).
      if (id === 'hex' && /hex-ok:/.test(here + prev)) continue
      if (
        id === 'hex' &&
        !/<template|class=|:style|style=/.test(text.slice(0, m.index).slice(-400))
      ) {
        // hex trong script thuần (bảng màu dữ liệu, mermaid…) vẫn báo nhưng ở mức nhẹ
      }
      hits.push({ id, ln, msg, frag: here.trim().slice(0, 100) })
    }
  }
  // Class skin cũ trong template.
  const tpl = text.match(/<template>[\s\S]*<\/template>/)?.[0] ?? ''
  const tplStart = text.indexOf(tpl)
  for (const m of tpl.matchAll(/(?<![:\w-])class="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/)) {
      if (legacyClasses.has(c)) {
        const ln = lineOf(text, tplStart + m.index)
        const prev = lines[ln - 2] ?? ''
        if (/hook-ok:/.test(lines[ln - 1] + prev)) continue
        // Thẻ nhiều dòng: comment `hook-ok:` đặt ngay trên dòng mở thẻ `<tag`.
        // Comment có thể dài nhiều dòng — đọc ngược cả khối `<!-- … -->` liền trên.
        const tagLn = lineOf(text, text.lastIndexOf('<', tplStart + m.index))
        let above = lines[tagLn - 1] ?? ''
        for (let i = tagLn - 2; i >= 0 && i >= tagLn - 8; i--) {
          above += lines[i]
          if (lines[i].includes('<!--')) break
          if (!/-->\s*$/.test(lines[i]) && i === tagLn - 2 && !lines[i].trim()) break
        }
        if (/hook-ok:/.test(above)) continue
        hits.push({
          id: 'legacy-class',
          ln,
          msg: `Class skin cũ \`.${c}\` (prototype/app-shell.css)`,
          frag: c,
        })
      }
    }
  }
  return hits
}

const args = process.argv.slice(2)
const summary = args[0] === '--summary'
const targets = (summary ? args.slice(1) : args).map((a) =>
  a.startsWith('/') ? a : join(process.cwd(), a),
)
if (!targets.length) {
  console.error('usage: check-shadcn-migration.mjs [--summary] <file|dir>...')
  process.exit(2)
}
const files = targets.flatMap((t) => walk(t, []))
const totals = {}
let dirty = 0
for (const f of files) {
  const hits = check(f)
  if (!hits.length) continue
  dirty++
  for (const h of hits) totals[h.id] = (totals[h.id] ?? 0) + 1
  if (!summary) {
    console.log(relative(ROOT, f))
    for (const h of hits) console.log(`  ${h.ln}: [${h.id}] ${h.msg} — ${h.frag}`)
  }
}
console.log(`\n${dirty}/${files.length} file còn vi phạm`, totals)
process.exit(dirty ? 1 : 0)
