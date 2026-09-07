// Chẩn đoán TĨNH một skill — không gọi model, không tốn tiền.
//
// Vòng đời skill trước đây chỉ có CRUD: người dùng viết xong một SKILL.md rồi
// không có cách nào biết nó có kích hoạt đúng lúc không. Chỗ skill hay hỏng nhất
// lại nằm ở metadata chứ không ở nội dung: `description` mơ hồ thì model không
// bao giờ gọi tới, id trùng giữa hai tier thì bản global che bản project, link
// tới `scripts/run.py` gãy thì skill chạy giữa chừng mới chết.
//
// Module này chia làm hai lớp:
//   • inspectSkillContent — THUẦN (không I/O), nhận sẵn raw + danh sách file +
//     các skill anh em, trả về danh sách vấn đề. Đây là chỗ có test.
//   • diagnoseSkill       — đọc đĩa (L1: cap kích thước, cap số entry) rồi gọi
//     lớp thuần ở trên.
//
// Vấn đề trả về là MÁY ĐỌC ĐƯỢC (`rule` + `params`), không phải câu tiếng Anh:
// UI dựng câu qua i18n en+vi (xem i18n/locales/*/skills-eval.json).

import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, posix, relative, resolve, sep } from 'node:path'
import { claudeHome, projectClaudeDir, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { loadProject } from '../projects/store.js'
import { parseFrontmatter } from './frontmatter.js'
import type { SkillSource } from '../types/shared.js'

export type SkillIssueSeverity = 'error' | 'warn' | 'info'

export type SkillIssueRule =
  // Frontmatter / định danh
  | 'unreadable'
  | 'missing-name'
  | 'missing-description'
  | 'invalid-id'
  | 'name-id-mismatch'
  | 'unknown-frontmatter-key'
  // Mô tả — điều kiện kích hoạt
  | 'description-too-short'
  | 'description-too-long'
  | 'description-no-trigger'
  // Va chạm giữa các skill
  | 'shadowed-id'
  | 'duplicate-name'
  // Thân bài
  | 'body-empty'
  | 'body-thin'
  | 'body-too-large'
  // Tài nguyên trong thư mục skill
  | 'broken-link'
  | 'link-outside-folder'
  | 'oversized-asset'

export interface SkillIssue {
  rule: SkillIssueRule
  severity: SkillIssueSeverity
  // Tham số để UI dựng câu. Chỉ số hoặc chuỗi NGẮN đã cắt — không nhồi cả body.
  params?: Record<string, string | number>
}

export interface SkillDoctorStats {
  fileBytes: number
  bodyChars: number
  descriptionChars: number
  assetFiles: number
}

export interface SkillRef {
  id: string
  source: SkillSource
  projectId?: string | undefined
}

export interface SkillDoctorReport extends SkillRef {
  checkedAt: number
  issues: SkillIssue[]
  stats: SkillDoctorStats
}

// Ngưỡng. Con số rút từ chính hình dạng SKILL.md: description là thứ DUY NHẤT
// model thấy trước khi quyết định nạp skill, nên quá ngắn = không đủ tín hiệu,
// quá dài = ăn ngân sách catalogue của mọi lượt chat.
export const DESCRIPTION_MIN_CHARS = 40
export const DESCRIPTION_MAX_CHARS = 500
export const BODY_THIN_CHARS = 200
export const BODY_LARGE_BYTES = 32 * 1024
// Trần đọc file: SKILL.md trên đĩa là L1. Trên ngưỡng này thì không đọc nội dung
// (chỉ báo body-too-large) để một file 200MB không kéo sập sidecar.
export const MAX_READ_BYTES = 512 * 1024
export const OVERSIZED_ASSET_BYTES = 1024 * 1024
// Trần quét thư mục skill: số entry và độ sâu. Thư mục skill là vài file kèm
// theo, không phải một cây source.
const MAX_ASSET_ENTRIES = 500
const MAX_ASSET_DEPTH = 2

const ID_RE = /^[a-z0-9][a-z0-9-]*$/

// Key frontmatter AWOG hiểu, cộng vài key phổ biến của Claude Code CLI mà AWOG
// bỏ qua nhưng KHÔNG phải lỗi (skill dùng chung `.claude` với CLI — ADR 0070).
const KNOWN_FRONTMATTER_KEYS = new Set([
  'name',
  'description',
  'icon',
  'globs',
  'alwaysallow',
  'requiredsources',
  'allowed-tools',
  'license',
  'version',
  'model',
  'metadata',
])

// Dấu hiệu "mô tả có nêu ĐIỀU KIỆN kích hoạt" chứ không chỉ nêu skill làm gì.
// Cả tiếng Anh lẫn tiếng Việt vì SKILL.md của người dùng viết bằng cả hai.
const TRIGGER_RE =
  /\b(when|whenever|if|use this|use when|invoke|trigger|applies to|for (?:tasks|requests|questions))\b|khi |nếu |dùng cho|áp dụng/i

export interface SkillSibling {
  id: string
  source: SkillSource
  projectId?: string | undefined
  name: string
}

export interface InspectInput {
  id: string
  source: SkillSource
  projectId?: string | undefined
  // Nội dung SKILL.md. null = không đọc được / quá lớn (xem `unreadable`).
  raw: string | null
  fileBytes: number
  // Đường dẫn TƯƠNG ĐỐI (posix) của file trong thư mục skill, kèm kích thước.
  assets: { path: string; bytes: number }[]
  // Mọi skill đã quét được ở các tier đang mở, KỂ CẢ chính nó.
  siblings: SkillSibling[]
}

function issue(
  rule: SkillIssueRule,
  severity: SkillIssueSeverity,
  params?: Record<string, string | number>,
): SkillIssue {
  return params ? { rule, severity, params } : { rule, severity }
}

// Cắt chuỗi trước khi nhét vào params — params đi thẳng lên UI.
function clip(value: string, max = 80): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

// Slug hoá tên hiển thị để so với id thư mục ("PDF Filler" → "pdf-filler").
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Thư mục kèm theo mà SKILL.md quy ước dùng. Một path trong backtick bắt đầu
// bằng một trong số này gần như chắc chắn trỏ vào thư mục skill, không phải vào
// repo của người dùng.
const ASSET_FOLDER_HINTS = new Set([
  'scripts',
  'references',
  'assets',
  'templates',
  'examples',
  'data',
  'bin',
])

interface LocalRef {
  target: string
  // Bằng chứng YẾU: path lấy từ backtick. Body skill hay nhắc path của REPO
  // người dùng (`src/index.ts`) — báo gãy cho những path đó là báo nhảm, nên ref
  // yếu chỉ được kiểm khi có dấu hiệu nó trỏ vào thư mục skill.
  weak: boolean
}

// Ứng viên "đường dẫn tới file trong thư mục skill" nhặt từ body:
//   • link markdown  [x](scripts/run.py)        — bằng chứng mạnh
//   • path trong backtick  `references/x.json`  — bằng chứng yếu
// Bỏ qua http(s)/mailto/anchor/đường dẫn tuyệt đối — chúng không phải file kèm.
function collectLocalRefs(body: string): LocalRef[] {
  const out = new Map<string, LocalRef>()
  const push = (target: string, weak: boolean): void => {
    const value = target.trim().split('#')[0]?.split('?')[0] ?? ''
    if (!value) return
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return // scheme (http:, mailto:, …)
    if (value.startsWith('/') || value.startsWith('~')) return // ngoài phạm vi skill
    if (!/^[\w./\- ]+$/.test(value)) return
    if (!/\.[A-Za-z0-9]{1,8}$/.test(value)) return // phải trông như tên file
    const previous = out.get(value)
    if (!previous || (previous.weak && !weak)) out.set(value, { target: value, weak })
  }
  for (const m of body.matchAll(/\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) push(m[1] ?? '', false)
  for (const m of body.matchAll(/`([^`\n]{1,120})`/g)) {
    const token = (m[1] ?? '').trim()
    if (token.includes('/') || token.startsWith('./')) push(token, true)
  }
  return [...out.values()]
}

// Ref yếu chỉ được kiểm khi nó tự nhận là tương đối (`./`), nằm dưới một thư mục
// kèm theo có thật, hoặc dùng đúng tên thư mục quy ước của SKILL.md.
function shouldCheckWeakRef(target: string, assetDirs: Set<string>): boolean {
  if (target.startsWith('./')) return true
  const first = target.split('/')[0] ?? ''
  return assetDirs.has(first) || ASSET_FOLDER_HINTS.has(first)
}

// Đường dẫn tương đối có ra khỏi thư mục skill không (không đụng đĩa).
function escapesFolder(relPath: string): boolean {
  const normalized = posix.normalize(relPath.replace(/\\/g, '/'))
  return normalized.startsWith('../') || normalized === '..'
}

function checkFrontmatter(
  input: InspectInput,
  data: Record<string, string | string[]>,
  issues: SkillIssue[],
): { name: string; description: string } {
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  const description = typeof data.description === 'string' ? data.description.trim() : ''

  if (!name) issues.push(issue('missing-name', 'error'))
  if (!description) issues.push(issue('missing-description', 'error'))
  if (!ID_RE.test(input.id)) issues.push(issue('invalid-id', 'error', { id: clip(input.id) }))
  if (name && ID_RE.test(input.id) && slugify(name) !== input.id) {
    issues.push(issue('name-id-mismatch', 'info', { name: clip(name), id: input.id }))
  }
  for (const key of Object.keys(data)) {
    if (!KNOWN_FRONTMATTER_KEYS.has(key.toLowerCase())) {
      issues.push(issue('unknown-frontmatter-key', 'info', { key: clip(key, 40) }))
    }
  }
  return { name, description }
}

function checkDescription(description: string, issues: SkillIssue[]): void {
  if (!description) return
  if (description.length < DESCRIPTION_MIN_CHARS) {
    issues.push(
      issue('description-too-short', 'warn', {
        chars: description.length,
        min: DESCRIPTION_MIN_CHARS,
      }),
    )
  }
  if (description.length > DESCRIPTION_MAX_CHARS) {
    issues.push(
      issue('description-too-long', 'warn', {
        chars: description.length,
        max: DESCRIPTION_MAX_CHARS,
      }),
    )
  }
  if (!TRIGGER_RE.test(description)) {
    issues.push(issue('description-no-trigger', 'warn'))
  }
}

function checkCollisions(input: InspectInput, name: string, issues: SkillIssue[]): void {
  const isSelf = (s: SkillSibling): boolean =>
    s.id === input.id &&
    s.source === input.source &&
    (s.projectId ?? undefined) === (input.projectId ?? undefined)

  for (const sibling of input.siblings) {
    if (isSelf(sibling)) continue
    if (sibling.id === input.id) {
      issues.push(issue('shadowed-id', 'warn', { id: input.id, otherSource: sibling.source }))
      continue
    }
    if (name && sibling.name.trim().toLowerCase() === name.toLowerCase()) {
      issues.push(issue('duplicate-name', 'warn', { name: clip(name), otherId: sibling.id }))
    }
  }
}

function checkAssets(input: InspectInput, body: string, issues: SkillIssue[]): void {
  const present = new Set(input.assets.map((a) => a.path))
  const assetDirs = new Set(
    input.assets.map((a) => a.path.split('/')[0] ?? '').filter((d) => d.length > 0),
  )
  for (const ref of collectLocalRefs(body)) {
    if (escapesFolder(ref.target)) {
      issues.push(issue('link-outside-folder', 'warn', { target: clip(ref.target) }))
      continue
    }
    if (ref.weak && !shouldCheckWeakRef(ref.target, assetDirs)) continue
    const normalized = posix.normalize(ref.target.replace(/^\.\//, ''))
    if (!present.has(normalized)) {
      issues.push(issue('broken-link', 'warn', { target: clip(ref.target) }))
    }
  }
  for (const asset of input.assets) {
    if (asset.bytes > OVERSIZED_ASSET_BYTES) {
      issues.push(
        issue('oversized-asset', 'info', {
          path: clip(asset.path),
          kb: Math.round(asset.bytes / 1024),
        }),
      )
    }
  }
}

// Lớp thuần: mọi luật doctor sống ở đây, không I/O ⇒ test được thẳng.
export function inspectSkillContent(input: InspectInput): {
  issues: SkillIssue[]
  stats: SkillDoctorStats
} {
  const issues: SkillIssue[] = []

  if (input.raw === null) {
    issues.push(issue('unreadable', 'error', { bytes: input.fileBytes }))
    if (input.fileBytes > MAX_READ_BYTES) {
      issues.push(
        issue('body-too-large', 'warn', {
          kb: Math.round(input.fileBytes / 1024),
          maxKb: Math.round(BODY_LARGE_BYTES / 1024),
        }),
      )
    }
    return {
      issues,
      stats: { fileBytes: input.fileBytes, bodyChars: 0, descriptionChars: 0, assetFiles: 0 },
    }
  }

  const { data, body } = parseFrontmatter(input.raw)
  const { name, description } = checkFrontmatter(input, data, issues)
  checkDescription(description, issues)
  checkCollisions(input, name, issues)

  const trimmedBody = body.trim()
  if (trimmedBody.length === 0) issues.push(issue('body-empty', 'error'))
  else if (trimmedBody.length < BODY_THIN_CHARS) {
    issues.push(issue('body-thin', 'warn', { chars: trimmedBody.length, min: BODY_THIN_CHARS }))
  }
  if (input.fileBytes > BODY_LARGE_BYTES) {
    issues.push(
      issue('body-too-large', 'warn', {
        kb: Math.round(input.fileBytes / 1024),
        maxKb: Math.round(BODY_LARGE_BYTES / 1024),
      }),
    )
  }

  checkAssets(input, trimmedBody, issues)

  return {
    issues,
    stats: {
      fileBytes: input.fileBytes,
      bodyChars: trimmedBody.length,
      descriptionChars: description.length,
      assetFiles: input.assets.length,
    },
  }
}

// Lớp I/O ---------------------------------------------------------------------

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

// Thư mục chứa các skill của một tier. Cố ý KHÔNG dùng lại helper private của
// store.ts: doctor phải đọc RAW (store bỏ qua file thiếu name/description — đúng
// những file doctor cần soi nhất).
export async function skillFolderPath(
  id: string,
  source: SkillSource,
  projectId?: string,
): Promise<string | null> {
  const child = sanitizeChild(id)
  if (source === 'global') return join(claudeHome(), 'skills', child)
  if (!projectId) return null
  const project = await loadProject(projectId)
  if (!project) return null
  return join(projectClaudeDir(project.path), 'skills', child)
}

// Liệt kê file kèm theo trong thư mục skill (bỏ chính SKILL.md). Cap cả số entry
// lẫn độ sâu; lỗi đọc thư mục con thì bỏ qua nhánh đó thay vì ném.
async function listAssets(folder: string): Promise<{ path: string; bytes: number }[]> {
  const out: { path: string; bytes: number }[] = []
  const queue: { dir: string; depth: number }[] = [{ dir: folder, depth: 0 }]
  while (queue.length > 0 && out.length < MAX_ASSET_ENTRIES) {
    const current = queue.shift()
    if (!current) break
    let entries: Dirent[]
    try {
      // eslint-disable-next-line no-await-in-loop
      entries = await readdir(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (out.length >= MAX_ASSET_ENTRIES) break
      const full = join(current.dir, entry.name)
      if (entry.isDirectory()) {
        if (current.depth + 1 < MAX_ASSET_DEPTH) queue.push({ dir: full, depth: current.depth + 1 })
        continue
      }
      if (!entry.isFile()) continue
      if (current.depth === 0 && entry.name === 'SKILL.md') continue
      let bytes = 0
      try {
        // eslint-disable-next-line no-await-in-loop
        bytes = (await stat(full)).size
      } catch {
        continue
      }
      out.push({ path: relative(folder, full).split(sep).join('/'), bytes })
    }
  }
  return out
}

export interface DiagnoseDeps {
  // Mọi skill đã quét ở các tier đang mở (dùng để bắt trùng id/tên). Người gọi
  // truyền vào để doctor không phải tự quyết định quét tier nào.
  siblings: SkillSibling[]
}

export async function diagnoseSkill(
  ref: SkillRef,
  deps: DiagnoseDeps,
): Promise<SkillDoctorReport> {
  const folder = await skillFolderPath(ref.id, ref.source, ref.projectId)
  const base: SkillRef = { id: ref.id, source: ref.source }
  if (ref.projectId) base.projectId = ref.projectId

  if (!folder) {
    return {
      ...base,
      checkedAt: Date.now(),
      issues: [{ rule: 'unreadable', severity: 'error' }],
      stats: { fileBytes: 0, bodyChars: 0, descriptionChars: 0, assetFiles: 0 },
    }
  }

  const file = join(folder, 'SKILL.md')
  let fileBytes = 0
  let raw: string | null = null
  try {
    fileBytes = (await stat(file)).size
    if (fileBytes <= MAX_READ_BYTES) raw = await readFile(file, 'utf8')
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('skills.doctor: failed to read SKILL.md', {
        file,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const assets = raw === null ? [] : await listAssets(resolve(folder))
  const { issues, stats } = inspectSkillContent({
    ...base,
    raw,
    fileBytes,
    assets,
    siblings: deps.siblings,
  })

  return { ...base, checkedAt: Date.now(), issues, stats }
}
