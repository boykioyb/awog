// Kho bảng điều khiển 2 tier: `~/.awog/dashboards/<id>.json` + `{project}/.awog/dashboards/<id>.json`.
//
// RUỘT FILE LÀ MỘT `DashboardDraft` TRẦN — không `id`, không `tier`, không
// `updatedAt`. Cả ba suy ra từ ĐƯỜNG DẪN và từ mtime:
//   · `id` từ TÊN FILE, `tier` từ THƯ MỤC — cùng luật với playbook và wiki: một file
//     copy sang tier khác mà vẫn mang tier cũ trong ruột là một lời nói dối trên đĩa.
//   · `updatedAt` từ mtime. Ghi nó vào ruột là mở đường cho một con số nói dối thứ
//     hai: người dùng sửa file bằng trình soạn thảo thì mtime đúng còn con số đã ghi
//     thì không. Một nguồn, không phải hai.
// Nhờ vậy file chỉ còn đúng thứ người dùng thật sự viết, và `NaN`/`null` không có
// chỗ chen vào.
//
// ĐỌC LÀ DỮ LIỆU L1. File người dùng sửa tay được, nên mọi thứ parse ra đều qua
// `DashboardDraftSchema` rồi `validateDashboard` trước khi thành `Dashboard`. `list`
// CỐ Ý không ném khi một file hỏng: nó trả dòng kèm `issues` để UI nói được "file
// này sai chỗ nào" thay vì lặng lẽ bỏ qua.

import { chmod, mkdir, readdir, readFile, realpath, rm, stat, writeFile, rename } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { log } from '../../util/logger.js'
import { RpcError } from '../../transport/rpc.js'
import { awogHome, sanitizeChild } from '../../util/path.js'
import { loadProject } from '../../projects/store.js'
import {
  DashboardDraftSchema,
  buildDashboard,
  isValidDashboardId,
  validateDashboard,
} from './schema.js'
import type {
  Dashboard,
  DashboardDraft,
  DashboardIssue,
  DashboardSource,
  DashboardTier,
} from './schema.js'

const DASHBOARDS_DIR = sanitizeChild('dashboards')
const MAX_DASHBOARDS_PER_ROOT = 500

// ─── Đường dẫn ───────────────────────────────────────────────────────────────

export function globalDashboardsRoot(): string {
  return join(awogHome(), DASHBOARDS_DIR)
}

export function projectDashboardsRoot(projectPath: string): string {
  return join(projectPath, '.awog', DASHBOARDS_DIR)
}

export async function resolveDashboardsRoot(
  source: DashboardSource,
  projectId: string | undefined,
): Promise<string> {
  if (source === 'builtin') throw new RpcError(-32602, 'Built-in dashboards are not on disk')
  if (source === 'global') return globalDashboardsRoot()
  if (!projectId) throw new RpcError(-32602, 'Project dashboards require a projectId')
  const project = await loadProject(projectId)
  if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
  return projectDashboardsRoot(project.path)
}

function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root + sep)
}

/**
 * Chặn thoát khỏi thư mục bảng điều khiển, symlink tính cả. Bản sao thu nhỏ của
 * `wiki/paths.ts#assertInsideWiki` — `git/path-sanitize.ts` bám vào workspace nên
 * không dùng lại được, và hai tier ở đây nằm ngoài workspace.
 */
async function assertInsideDashboards(root: string, abs: string, mustExist: boolean): Promise<void> {
  if (!within(resolve(abs), resolve(root))) {
    throw new RpcError(-32602, 'Dashboard path escapes the dashboards root')
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
    throw new RpcError(-32602, 'Dashboard path escapes the dashboards root via a symlink')
  }
}

function dashboardFile(root: string, id: string): string {
  return resolve(root, `${sanitizeChild(id)}.json`)
}

function assertDashboardId(id: string): void {
  if (!isValidDashboardId(id)) {
    throw new RpcError(-32602, `Invalid dashboard id: ${id}`)
  }
}

// ─── Tuần tự hoá ─────────────────────────────────────────────────────────────

/** Ruột file = đúng bản nháp, không hơn. Xem ghi chú đầu file. */
export function serializeDashboard(draft: DashboardDraft): string {
  return `${JSON.stringify(draft, null, 2)}\n`
}

export type ParsedFile =
  | { ok: true; dashboard: Dashboard }
  | { ok: false; issues: DashboardIssue[] }

/**
 * Parse ruột một file bảng điều khiển. `id`/`tier`/`updatedAt` do NGƯỜI GỌI cấp
 * (từ tên file, thư mục, mtime) — không đọc từ ruột file.
 */
export function parseDashboardText(
  raw: string,
  meta: { id: string; tier: DashboardTier; updatedAt: string },
): ParsedFile {
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch (err) {
    return {
      ok: false,
      issues: [
        {
          code: 'dashboard.error.badJson',
          message: `cannot read the file: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    }
  }

  const parsed = DashboardDraftSchema.safeParse(payload)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        code: 'dashboard.error.invalid',
        message: `${i.path.join('.') || '<root>'}: ${i.message}`,
      })),
    }
  }

  const dashboard = buildDashboard(parsed.data, meta)
  const issues = validateDashboard(dashboard)
  return issues.length > 0 ? { ok: false, issues } : { ok: true, dashboard }
}

// ─── Tóm tắt ─────────────────────────────────────────────────────────────────

/**
 * Dòng cho DANH SÁCH. `list` không trả cả biểu đồ: một bảng có tới 12 biểu đồ × 6
 * chuỗi, và màn Bảng điều khiển chỉ cần tên cùng vài con số để vẽ sidebar. Ruột đầy
 * đủ đến qua `read` khi người dùng thật sự mở nó.
 */
export type DashboardSummary = {
  id: string
  name: string
  description: string
  source: DashboardSource
  tier: DashboardTier
  projectId?: string
  updatedAt: string
  chartCount: number
  seriesCount: number
  /** Khác rỗng khi file hỏng: UI hiện được "sai chỗ nào" thay vì bỏ qua im lặng. */
  issues: DashboardIssue[]
}

export function summarizeDashboard(
  dashboard: Dashboard,
  source: DashboardSource,
  projectId?: string | undefined,
): DashboardSummary {
  const summary: DashboardSummary = {
    id: dashboard.id,
    name: dashboard.name,
    description: dashboard.description,
    source,
    tier: dashboard.tier,
    updatedAt: dashboard.updatedAt,
    chartCount: dashboard.charts.length,
    seriesCount: dashboard.charts.reduce((n, c) => n + c.series.length, 0),
    issues: [],
  }
  if (projectId !== undefined) summary.projectId = projectId
  return summary
}

function brokenSummary(
  id: string,
  source: DashboardSource,
  projectId: string | undefined,
  issues: DashboardIssue[],
): DashboardSummary {
  const summary: DashboardSummary = {
    id,
    name: id,
    description: '',
    source,
    tier: source === 'project' ? 'project' : 'global',
    updatedAt: new Date(0).toISOString(),
    chartCount: 0,
    seriesCount: 0,
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
  source: DashboardSource,
  projectId: string | undefined,
): Promise<DashboardSummary[]> {
  let names: string[]
  try {
    names = await readdir(root)
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('dashboards: readdir failed', {
        dir: root,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    return []
  }

  const out: DashboardSummary[] = []
  for (const name of names) {
    if (out.length >= MAX_DASHBOARDS_PER_ROOT) break
    if (name.startsWith('.') || !name.endsWith('.json')) continue
    const id = name.slice(0, -5)
    if (!isValidDashboardId(id)) continue
    const file = join(root, name)
    try {
      const [raw, st] = await Promise.all([readFile(file, 'utf8'), stat(file)])
      const updatedAt = new Date(st.mtimeMs).toISOString()
      const parsed = parseDashboardText(raw, {
        id,
        tier: source === 'project' ? 'project' : 'global',
        updatedAt,
      })
      if (parsed.ok) out.push(summarizeDashboard(parsed.dashboard, source, projectId))
      else {
        const broken = brokenSummary(id, source, projectId, parsed.issues)
        broken.updatedAt = updatedAt
        out.push(broken)
      }
    } catch (err) {
      log.warn('dashboards: failed to read', {
        file,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id))
  return out
}

/** Quét cả hai tier. `projectIds` rỗng = chỉ tier global. */
export async function listDashboards(
  projectIds: readonly string[] = [],
): Promise<DashboardSummary[]> {
  const out = await scanRoot(globalDashboardsRoot(), 'global', undefined)
  for (const projectId of projectIds) {
    // eslint-disable-next-line no-await-in-loop
    const project = await loadProject(projectId)
    if (!project) continue
    // eslint-disable-next-line no-await-in-loop
    out.push(...(await scanRoot(projectDashboardsRoot(project.path), 'project', projectId)))
  }
  return out
}

/**
 * Đọc một bảng mà KHÔNG ném vì file hỏng: trả `null` khi không có file, và
 * `{ ok: false, issues }` khi file sai. Đây là hình dạng cho tầng RPC — ở đó "file
 * người dùng viết bị sai" là một câu trả lời bình thường, không phải sự cố.
 */
export async function readDashboard(
  source: DashboardSource,
  projectId: string | undefined,
  id: string,
): Promise<ParsedFile | null> {
  assertDashboardId(id)
  const root = await resolveDashboardsRoot(source, projectId)
  const file = dashboardFile(root, id)
  await assertInsideDashboards(root, file, true)
  let raw: string
  let mtimeMs: number
  try {
    const [text, st] = await Promise.all([readFile(file, 'utf8'), stat(file)])
    raw = text
    mtimeMs = st.mtimeMs
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
  return parseDashboardText(raw, {
    id,
    tier: source === 'project' ? 'project' : 'global',
    updatedAt: new Date(mtimeMs).toISOString(),
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

export type SaveDashboardInput = {
  source: 'global' | 'project'
  projectId?: string | undefined
  id: string
  draft: DashboardDraft
}

/**
 * Ghi một bảng điều khiển. Lỗi CẤU TRÚC chặn ở đây — trùng khoá chuỗi, stat không
 * hợp lệ, quá trần chuỗi của một vùng. Trần chuỗi phải chặn lúc LƯU chứ không phải
 * lúc NẠP: một bảng vượt `MAX_SERIES_PER_REQUEST` làm `infra.metrics-query` từ chối
 * NGUYÊN lượt, nên để nó lưu được rồi mới hỏng ở màn hình là giấu lỗi vào chỗ đắt
 * nhất (mỗi lượt nạp là một lượt trả tiền).
 */
export async function saveDashboard(input: SaveDashboardInput): Promise<Dashboard> {
  assertDashboardId(input.id)
  const tier: DashboardTier = input.source === 'project' ? 'project' : 'global'
  const updatedAt = new Date().toISOString()
  const dashboard = buildDashboard(input.draft, { id: input.id, tier, updatedAt })
  const issues = validateDashboard(dashboard)
  if (issues.length > 0) throw new RpcError(-32602, 'Invalid dashboard', { issues })

  const root = await resolveDashboardsRoot(input.source, input.projectId)
  const file = dashboardFile(root, input.id)
  await assertInsideDashboards(root, file, false)
  // Ghi bản ĐÃ CHUẨN HOÁ, không ghi `input.draft`: `buildDashboard` cắt khoảng trắng
  // ở `name`/`title`, nên ghi bản nháp thô là để đĩa và object trả về nói hai câu
  // khác nhau về cùng một bảng.
  const persisted: DashboardDraft = {
    name: dashboard.name,
    description: dashboard.description,
    charts: dashboard.charts,
  }
  await writeAtomic(file, serializeDashboard(persisted))
  return dashboard
}

export async function deleteDashboard(
  source: DashboardSource,
  projectId: string | undefined,
  id: string,
): Promise<void> {
  if (source === 'builtin') throw new RpcError(-32602, 'Built-in dashboards cannot be deleted')
  assertDashboardId(id)
  const root = await resolveDashboardsRoot(source, projectId)
  const file = dashboardFile(root, id)
  await assertInsideDashboards(root, file, true)
  try {
    await rm(file)
  } catch (err) {
    if (!isMissing(err)) throw err
  }
}
