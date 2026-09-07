// Lưu trữ Output Style do NGƯỜI DÙNG tự viết (WP11 — bổ sung cho 21 style dựng
// sẵn trong ./styles.ts). Hai tier, đúng mô hình đang dùng cho Rules (ADR 0033);
// style là dữ liệu AWOG-only nên nằm dưới `.awog` chứ không phải `.claude`
// (ADR 0070):
//   global  → ~/.awog/styles/<id>.md
//   project → {project.path}/.awog/styles/<id>.md
//
// Mỗi style = 1 file Markdown: frontmatter (`name`, `description`) + body chính
// là directive được append vào system prompt. `source`/`projectId` suy ra từ vị
// trí file (KHÔNG ghi vào file — style tier project commit vào repo không được
// hardcode id project vốn chỉ đúng trên một máy).
//
// BẢO MẬT: file `.md` đọc từ đĩa là dữ liệu L1. Ở đây validate bằng zod + cap
// kích thước; file hỏng thì BỎ QUA + log, không bao giờ làm sập sidecar. Nội
// dung body đi thẳng vào system prompt — xem docs/features/response-styles.md
// phần "Bề mặt tin cậy".

import { mkdir, readdir, readFile, writeFile, chmod, rename, unlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'
import { parseFrontmatter, serializeFrontmatter } from '../skills/frontmatter.js'

export type StyleSource = 'global' | 'project'

export type UserStyle = {
  id: string
  name: string
  description: string
  // Directive append vào system prompt cho mỗi lượt của session.
  body: string
  source: StyleSource
  projectId?: string
}

export type StyleScanReport = {
  dir: string
  source: StyleSource
  found: number
  projectId?: string
}

const STYLES_DIR_NAME = 'styles'

// Cả file: chặn một file khổng lồ bị nuốt vào system prompt (hoặc vào RAM).
export const MAX_STYLE_FILE_BYTES = 64 * 1024
// Directive: giới hạn "mềm" hơn nhiều — style là chỉ dẫn giọng văn vài dòng, đi
// kèm MỌI lượt nên mỗi ký tự đều tính tiền token.
export const MAX_STYLE_BODY_CHARS = 8_000

// Id dành riêng: `auto` là meta-style (styles.ts), `default`/`normal` là sentinel
// "không style" của UI. Cho phép người dùng chiếm các id này sẽ làm hành vi lõi
// đổi nghĩa một cách bất ngờ.
export const RESERVED_STYLE_IDS = new Set(['auto', 'default', 'normal'])

// Id = tên file, nên chỉ nhận chữ thường/số/`-`/`_`/`.` (sanitizeChild vẫn chặn
// traversal ở lớp dưới; đây là lớp "hình dạng id" cho UI/RPC).
const STYLE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function isValidStyleId(id: string): boolean {
  return STYLE_ID_RE.test(id) && !RESERVED_STYLE_IDS.has(id)
}

export function globalStylesDir(): string {
  return join(awogHome(), STYLES_DIR_NAME)
}

export function projectStylesDir(projectPath: string): string {
  return join(projectPath, '.awog', STYLES_DIR_NAME)
}

export function styleFile(dir: string, id: string): string {
  return join(dir, `${sanitizeChild(id)}.md`)
}

async function resolveStylesDir(
  source: StyleSource,
  projectId: string | undefined,
): Promise<string> {
  if (source === 'global') return globalStylesDir()
  if (!projectId) throw new RpcError(-32602, 'Project style requires a projectId')
  const project = await loadProject(projectId)
  if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
  return projectStylesDir(project.path)
}

type FsError = Error & { code?: string }

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Frontmatter là L1: một giá trị có thể là string hoặc string[] (parser dùng
// chung với SKILL.md). Gộp về string trước khi đưa qua zod.
function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.join(', ')
  return value
}

const FrontmatterSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
})

// Parse + validate một file style. Trả null khi file hỏng (đã log) — người gọi
// bỏ qua style đó thay vì để cả danh sách / cả lượt chết theo.
export function parseStyleFile(
  raw: string,
  id: string,
  source: StyleSource,
  projectId: string | undefined,
  file: string,
): UserStyle | null {
  const { data, body } = parseFrontmatter(raw)
  const parsed = FrontmatterSchema.safeParse({
    name: asString(data.name),
    description: asString(data.description),
  })
  if (!parsed.success) {
    log.warn('styles: invalid frontmatter — file skipped', {
      file,
      issue: parsed.error.issues[0]?.message ?? 'invalid',
    })
    return null
  }
  const trimmed = body.trim()
  if (trimmed.length === 0) {
    log.warn('styles: empty body — file skipped (a style with no directive does nothing)', { file })
    return null
  }
  return {
    id,
    name: parsed.data.name ?? id,
    description: parsed.data.description ?? '',
    body: trimmed.slice(0, MAX_STYLE_BODY_CHARS),
    source,
    ...(projectId ? { projectId } : {}),
  }
}

function idFromFile(name: string): string {
  return name.endsWith('.md') ? name.slice(0, -3) : name
}

async function listFromDir(
  dir: string,
  source: StyleSource,
  projectId: string | undefined,
): Promise<UserStyle[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    if (!isMissing(err)) log.warn('styles: listFromDir failed', { dir, err: errMessage(err) })
    return []
  }
  const styles: UserStyle[] = []
  for (const name of entries) {
    if (!name.endsWith('.md')) continue
    const file = join(dir, name)
    try {
      // eslint-disable-next-line no-await-in-loop
      const info = await stat(file)
      if (info.size > MAX_STYLE_FILE_BYTES) {
        log.warn('styles: file too large — skipped', { file, size: info.size })
        continue
      }
      // eslint-disable-next-line no-await-in-loop
      const raw = await readFile(file, 'utf8')
      const style = parseStyleFile(raw, idFromFile(name), source, projectId, file)
      if (style) styles.push(style)
    } catch (err) {
      log.warn('styles: failed to read file', { file, err: errMessage(err) })
    }
  }
  return styles
}

// Danh sách đầy đủ cho UI: style global + style của từng project được hỏi tới,
// kèm report từng thư mục đã quét (để UI nói được "đã nhìn ở đâu").
export async function listUserStyles(
  projectIds: string[] = [],
): Promise<{ styles: UserStyle[]; reports: StyleScanReport[] }> {
  const reports: StyleScanReport[] = []
  const globalDir = globalStylesDir()
  const global = await listFromDir(globalDir, 'global', undefined)
  reports.push({ dir: globalDir, source: 'global', found: global.length })

  const perProject = await Promise.all(
    projectIds.map(async (id) => {
      const project = await loadProject(id)
      if (!project) return []
      const dir = projectStylesDir(project.path)
      const styles = await listFromDir(dir, 'project', id)
      reports.push({ dir, source: 'project', found: styles.length, projectId: id })
      return styles
    }),
  )

  const styles = [...global, ...perProject.flat()]
  styles.sort((a, b) => a.name.localeCompare(b.name))
  return { styles, reports }
}

export async function loadUserStyle(
  id: string,
  source: StyleSource = 'global',
  projectId?: string,
): Promise<UserStyle | null> {
  const dir = await resolveStylesDir(source, projectId)
  const file = styleFile(dir, id)
  try {
    const info = await stat(file)
    if (info.size > MAX_STYLE_FILE_BYTES) {
      log.warn('styles: file too large — skipped', { file, size: info.size })
      return null
    }
    const raw = await readFile(file, 'utf8')
    return parseStyleFile(raw, id, source, projectId, file)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

// Ghi atomic (tmp + rename) + chmod 600, đúng pattern của rules/store.ts.
export async function saveUserStyle(style: UserStyle): Promise<void> {
  const source = style.source ?? 'global'
  const dir = await resolveStylesDir(source, style.projectId)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const content = serializeFrontmatter(
    { name: style.name, description: style.description },
    style.body ?? '',
  )
  const file = styleFile(dir, style.id)
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, content, 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

export async function deleteUserStyle(
  id: string,
  source: StyleSource = 'global',
  projectId?: string,
): Promise<void> {
  const dir = await resolveStylesDir(source, projectId)
  try {
    await unlink(styleFile(dir, id))
  } catch (err) {
    if (!isMissing(err)) throw err
  }
}
