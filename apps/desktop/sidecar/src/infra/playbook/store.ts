// Kho playbook 2 tier: `~/.awog/playbooks/<id>.md` + `{project}/.awog/playbooks/<id>.md`.
//
// VÌ SAO MARKDOWN + FRONTMATTER, KHÔNG PHẢI JSON. Một playbook là thứ người ta
// ĐỌC (kế hoạch để duyệt), commit vào repo, và dán vào issue — nên nó phải là
// một file Markdown mở bằng trình soạn thảo nào cũng được. Phần máy đọc nằm
// trong MỘT khối ```json ở thân file, còn `name`/`description`/`kind`/`updatedAt`
// nằm ở frontmatter — nhờ vậy `list` đọc được metadata mà không phải parse cả
// khối bước, và người dùng sửa tiêu đề bằng tay vẫn ra đúng.
//
// `id` suy từ TÊN FILE, `tier` suy từ THƯ MỤC — không bao giờ ghi vào frontmatter.
// Cùng luật với wiki (`wiki/store.ts`): một file copy sang tier khác mà vẫn mang
// tier cũ trong ruột là một lời nói dối nằm trên đĩa.
//
// ĐỌC LÀ DỮ LIỆU L1. File do người dùng viết, nên mọi thứ parse ra đều bị
// `validatePlaybook` soi lại trước khi vào `Playbook`. `list` CỐ Ý không ném khi
// một file hỏng: nó trả về một dòng kèm `issues` để UI nói được "file này sai
// chỗ nào" thay vì lặng lẽ bỏ qua.

import { chmod, mkdir, readdir, readFile, realpath, rm, stat, writeFile, rename } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { log } from '../../util/logger.js'
import { RpcError } from '../../transport/rpc.js'
import { awogHome, sanitizeChild } from '../../util/path.js'
import { loadProject } from '../../projects/store.js'
import { parseFrontmatter, serializeFrontmatter } from '../../skills/frontmatter.js'
import {
  PlaybookDraftSchema,
  buildPlaybook,
  canSubmit,
  isValidPlaybookId,
  missingRollbackSteps,
  stepsOfVerb,
  validatePlaybook,
} from './schema.js'
import type {
  Playbook,
  PlaybookDraft,
  PlaybookIssue,
  PlaybookKind,
  PlaybookSource,
  PlaybookStep,
  PlaybookTier,
  PlaybookVariable,
} from './schema.js'

const PLAYBOOKS_DIR = sanitizeChild('playbooks')
const MAX_PAGES_PER_ROOT = 500
const MARKER = '<!-- awog:playbook -->'

// ─── Đường dẫn ───────────────────────────────────────────────────────────────

export function globalPlaybooksRoot(): string {
  return join(awogHome(), PLAYBOOKS_DIR)
}

export function projectPlaybooksRoot(projectPath: string): string {
  return join(projectPath, '.awog', PLAYBOOKS_DIR)
}

export async function resolvePlaybooksRoot(
  source: PlaybookSource,
  projectId: string | undefined,
): Promise<string> {
  if (source === 'builtin') throw new RpcError(-32602, 'Built-in playbooks are not on disk')
  if (source === 'global') return globalPlaybooksRoot()
  if (!projectId) throw new RpcError(-32602, 'Project playbooks require a projectId')
  const project = await loadProject(projectId)
  if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
  return projectPlaybooksRoot(project.path)
}

function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root + sep)
}

/**
 * Chặn thoát khỏi thư mục playbook, symlink tính cả. Bản sao thu nhỏ của
 * `wiki/paths.ts#assertInsideWiki` — `git/path-sanitize.ts` bám vào workspace nên
 * không dùng lại được, và hai tier ở đây nằm ngoài workspace.
 */
async function assertInsidePlaybooks(root: string, abs: string, mustExist: boolean): Promise<void> {
  if (!within(resolve(abs), resolve(root))) {
    throw new RpcError(-32602, 'Playbook path escapes the playbooks root')
  }
  let realRoot: string
  try {
    realRoot = await realpath(root)
  } catch {
    return // thư mục chưa tồn tại ⇒ không có symlink nào dẫn ra ngoài
  }
  const target = mustExist ? abs : dirname(abs)
  let real: string
  try {
    real = await realpath(target)
  } catch {
    return // đích chưa có; mkdir bên dưới chỉ chạy trong root đã kiểm ở trên
  }
  if (!within(real, realRoot)) {
    throw new RpcError(-32602, 'Playbook path escapes the playbooks root via a symlink')
  }
}

function playbookFile(root: string, id: string): string {
  return resolve(root, `${sanitizeChild(id)}.md`)
}

function assertPlaybookId(id: string): void {
  if (!isValidPlaybookId(id)) {
    throw new RpcError(-32602, `Invalid playbook id: ${id}`)
  }
}

// ─── Tuần tự hoá ─────────────────────────────────────────────────────────────

type Payload = { variables: PlaybookVariable[]; steps: PlaybookStep[] }

function payloadOf(playbook: Playbook): Payload {
  return {
    variables: playbook.variables.map((v) =>
      v.default === undefined
        ? { name: v.name, label: v.label, required: v.required }
        : { name: v.name, label: v.label, required: v.required, default: v.default },
    ),
    steps: playbook.steps.map((s) => ({
      id: s.id,
      title: s.title,
      verb: s.verb,
      tool: s.tool,
      args: [...s.args],
      note: s.note,
    })),
  }
}

export function serializePlaybook(playbook: Playbook): string {
  const front = serializeFrontmatter(
    {
      name: playbook.name,
      description: playbook.description,
      kind: playbook.kind,
      updatedAt: playbook.updatedAt,
    },
    [
      `# ${playbook.name}`,
      '',
      playbook.description,
      '',
      MARKER,
      '',
      '```json',
      JSON.stringify(payloadOf(playbook), null, 2),
      '```',
      '',
    ].join('\n'),
  )
  return front
}

const FENCE_RE = /```json[ \t]*\r?\n([\s\S]*?)```/
const KINDS: readonly PlaybookKind[] = ['instruction', 'deployment']

function asString(value: string | string[] | undefined, fallback = ''): string {
  if (Array.isArray(value)) return value.join(', ')
  return value ?? fallback
}

function extractPayload(body: string): unknown {
  const fenced = FENCE_RE.exec(body)
  const text = fenced ? fenced[1] : body
  return JSON.parse(text.trim())
}

export type ParsedFile =
  | { ok: true; playbook: Playbook }
  | { ok: false; issues: PlaybookIssue[] }

/**
 * Parse một file playbook. `id`/`tier` do NGƯỜI GỌI cấp (từ tên file và thư mục),
 * không đọc từ ruột file — xem ghi chú đầu file.
 */
export function parsePlaybookText(
  raw: string,
  meta: { id: string; tier: PlaybookTier; updatedAt?: string | undefined },
): ParsedFile {
  const { data, body } = parseFrontmatter(raw)
  let payload: unknown
  try {
    payload = extractPayload(body)
  } catch (err) {
    return {
      ok: false,
      issues: [
        {
          code: 'playbook.error.badJson',
          message: `cannot read the step block: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    }
  }

  const merged = {
    name: asString(data.name) || meta.id,
    description: asString(data.description),
    kind: KINDS.includes(asString(data.kind).trim() as PlaybookKind)
      ? (asString(data.kind).trim() as PlaybookKind)
      : 'instruction',
    variables: (payload as { variables?: unknown })?.variables ?? [],
    steps: (payload as { steps?: unknown })?.steps ?? [],
  }

  const parsed = PlaybookDraftSchema.safeParse(merged)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        code: 'playbook.error.invalid',
        message: `${i.path.join('.') || '<root>'}: ${i.message}`,
      })),
    }
  }

  const playbook = buildPlaybook(parsed.data, {
    id: meta.id,
    tier: meta.tier,
    updatedAt: asString(data.updatedAt) || meta.updatedAt || new Date().toISOString(),
  })
  const issues = validatePlaybook(playbook)
  return issues.length > 0 ? { ok: false, issues } : { ok: true, playbook }
}

// ─── Tóm tắt ─────────────────────────────────────────────────────────────────

export type PlaybookSummary = {
  id: string
  name: string
  description: string
  kind: PlaybookKind
  source: PlaybookSource
  tier: PlaybookTier
  projectId?: string
  updatedAt: string
  variables: PlaybookVariable[]
  stepCount: number
  checkCount: number
  doCount: number
  verifyCount: number
  rollbackCount: number
  /** Luật số một: `do` nào còn thiếu bước quay lui ⇒ không gửi duyệt được. */
  canSubmit: boolean
  /** Id các bước `do` chưa có `rollback` tương ứng — UI hiện thẳng danh sách này. */
  missingRollback: string[]
  /** Khác rỗng khi file hỏng: UI hiện được "sai chỗ nào" thay vì bỏ qua im lặng. */
  issues: PlaybookIssue[]
}

export function summarizePlaybook(
  playbook: Playbook,
  source: PlaybookSource,
  projectId?: string | undefined,
): PlaybookSummary {
  const summary: PlaybookSummary = {
    id: playbook.id,
    name: playbook.name,
    description: playbook.description,
    kind: playbook.kind,
    source,
    tier: playbook.tier,
    updatedAt: playbook.updatedAt,
    variables: playbook.variables.map((v) => ({ ...v })),
    stepCount: playbook.steps.length,
    checkCount: stepsOfVerb(playbook, 'check').length,
    doCount: stepsOfVerb(playbook, 'do').length,
    verifyCount: stepsOfVerb(playbook, 'verify').length,
    rollbackCount: stepsOfVerb(playbook, 'rollback').length,
    canSubmit: canSubmit(playbook),
    missingRollback: missingRollbackSteps(playbook).map((s) => s.id),
    issues: [],
  }
  if (projectId !== undefined) summary.projectId = projectId
  return summary
}

function brokenSummary(
  id: string,
  source: PlaybookSource,
  projectId: string | undefined,
  issues: PlaybookIssue[],
): PlaybookSummary {
  const summary: PlaybookSummary = {
    id,
    name: id,
    description: '',
    kind: 'instruction',
    source,
    tier: source === 'project' ? 'project' : 'global',
    updatedAt: new Date(0).toISOString(),
    variables: [],
    stepCount: 0,
    checkCount: 0,
    doCount: 0,
    verifyCount: 0,
    rollbackCount: 0,
    canSubmit: false,
    missingRollback: [],
    issues,
  }
  if (projectId !== undefined) summary.projectId = projectId
  return summary
}

// ─── Đọc ─────────────────────────────────────────────────────────────────────

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

async function scanRoot(
  root: string,
  source: PlaybookSource,
  projectId: string | undefined,
): Promise<PlaybookSummary[]> {
  let names: string[]
  try {
    names = await readdir(root)
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('playbooks: readdir failed', {
        dir: root,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    return []
  }

  const out: PlaybookSummary[] = []
  for (const name of names) {
    if (out.length >= MAX_PAGES_PER_ROOT) break
    if (name.startsWith('.') || !name.endsWith('.md')) continue
    const id = name.slice(0, -3)
    if (!isValidPlaybookId(id)) continue
    const file = join(root, name)
    try {
      const [raw, st] = await Promise.all([readFile(file, 'utf8'), stat(file)])
      const parsed = parsePlaybookText(raw, {
        id,
        tier: source === 'project' ? 'project' : 'global',
        updatedAt: new Date(st.mtimeMs).toISOString(),
      })
      if (parsed.ok) out.push(summarizePlaybook(parsed.playbook, source, projectId))
      else {
        const broken = brokenSummary(id, source, projectId, parsed.issues)
        broken.updatedAt = new Date(st.mtimeMs).toISOString()
        out.push(broken)
      }
    } catch (err) {
      log.warn('playbooks: failed to read', {
        file,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id))
  return out
}

/** Quét cả hai tier. `projectIds` rỗng = chỉ tier global. */
export async function listPlaybooks(projectIds: readonly string[] = []): Promise<PlaybookSummary[]> {
  const out = await scanRoot(globalPlaybooksRoot(), 'global', undefined)
  for (const projectId of projectIds) {
    // eslint-disable-next-line no-await-in-loop
    const project = await loadProject(projectId)
    if (!project) continue
    // eslint-disable-next-line no-await-in-loop
    out.push(...(await scanRoot(projectPlaybooksRoot(project.path), 'project', projectId)))
  }
  return out
}

/**
 * Đọc một playbook mà KHÔNG ném vì file hỏng: trả `null` khi không có file, và
 * `{ ok: false, issues }` khi file sai. Đây là hình dạng cho tầng RPC — ở đó "file
 * người dùng viết bị sai" là một câu trả lời bình thường, không phải sự cố.
 */
export async function readPlaybook(
  source: PlaybookSource,
  projectId: string | undefined,
  id: string,
): Promise<ParsedFile | null> {
  assertPlaybookId(id)
  const root = await resolvePlaybooksRoot(source, projectId)
  const file = playbookFile(root, id)
  await assertInsidePlaybooks(root, file, true)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
  return parsePlaybookText(raw, {
    id,
    tier: source === 'project' ? 'project' : 'global',
  })
}

// ─── Ghi ─────────────────────────────────────────────────────────────────────

async function writeAtomic(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, content, 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

export type SavePlaybookInput = {
  source: 'global' | 'project'
  projectId?: string | undefined
  id: string
  draft: PlaybookDraft
  updatedAt?: string | undefined
}

/**
 * Ghi một playbook. Lỗi CẤU TRÚC chặn ở đây (charset biến, id trùng, tham chiếu
 * biến chưa khai) — nhưng **luật rollback thì không**: một bản nháp còn thiếu
 * bước quay lui phải lưu được để còn sửa, chỉ lúc gửi duyệt mới bị chặn.
 */
export async function savePlaybook(input: SavePlaybookInput): Promise<Playbook> {
  assertPlaybookId(input.id)
  const tier: PlaybookTier = input.source === 'project' ? 'project' : 'global'
  const playbook = buildPlaybook(input.draft, {
    id: input.id,
    tier,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  })
  const issues = validatePlaybook(playbook)
  if (issues.length > 0) throw new RpcError(-32602, 'Invalid playbook', { issues })

  const root = await resolvePlaybooksRoot(input.source, input.projectId)
  const file = playbookFile(root, input.id)
  await assertInsidePlaybooks(root, file, false)
  await writeAtomic(file, serializePlaybook(playbook))
  return playbook
}

export async function deletePlaybook(
  source: PlaybookSource,
  projectId: string | undefined,
  id: string,
): Promise<void> {
  if (source === 'builtin') throw new RpcError(-32602, 'Built-in playbooks cannot be deleted')
  assertPlaybookId(id)
  const root = await resolvePlaybooksRoot(source, projectId)
  const file = playbookFile(root, id)
  await assertInsidePlaybooks(root, file, true)
  try {
    await rm(file)
  } catch (err) {
    if (!isMissing(err)) throw err
  }
}
