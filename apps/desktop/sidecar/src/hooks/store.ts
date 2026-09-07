// Hook persistence (ADR 0032 D-3/D-5/D-8). Two tiers, mirroring Workflows:
//   global  → ~/.awog/hooks/<id>.json              (authored locally → trusted)
//   project → {project.path}/.awog/hooks/<id>.json (travels with the repo)
//
// source/projectId/trusted/recentRuns are location- or runtime-derived and NOT
// part of the persisted JSON. Run audit log → ~/.awog/hooks/.runs/<id>.jsonl for
// global hooks, ~/.awog/hooks/.runs/<projectId>/<id>.jsonl for project hooks
// (project ids collide across projects — see runLogFile). Append-only, trimmed to
// RUN_LOG_MAX on read. Project-tier trust decisions →
// ~/.awog/hook-trust/<sha256(projectPath)>.json (NOT inside the hook file, and
// NOT inside the repo — see the trust section below, D-8). env `secret:KEY` refs
// reuse the MCP keychain helpers.

import { mkdir, readdir, readFile, writeFile, chmod, rename, unlink, appendFile, stat } from 'node:fs/promises'
import { join, dirname, isAbsolute, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'
import { expandSecrets, purgeServerSecrets } from '../mcp/secrets.js'
import { HookConfigSchema } from './schema.js'
import type { Hook, HookRunRecord, HookScanReport, HookSource } from '../types/shared.js'

const HOOKS_DIR_NAME = sanitizeChild('hooks')
const RUNS_DIR_NAME = '.runs'
const TRUST_FILE = '.trust.json'
const RUN_LOG_MAX = 1000
const RECENT_RUNS_SHOWN = 20

// ─── Directory resolution ────────────────────────────────────────────────────

function globalHooksDir(): string {
  return join(awogHome(), HOOKS_DIR_NAME)
}

function projectHooksDir(projectPath: string): string {
  return join(projectPath, '.awog', HOOKS_DIR_NAME)
}

async function resolveHooksDir(source: HookSource, projectId: string | undefined): Promise<string> {
  if (source === 'global') return globalHooksDir()
  if (!projectId) throw new RpcError(-32602, 'Project hook requires a projectId')
  const project = await loadProject(projectId)
  if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
  return projectHooksDir(project.path)
}

function hookFile(dir: string, id: string): string {
  return join(dir, `${sanitizeChild(id)}.json`)
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

// ─── Parse / tag ───────────────────────────────────────────────────────────

function parse(
  raw: string,
  file: string,
  source: HookSource,
  projectId: string | undefined,
): Hook | null {
  try {
    const obj = JSON.parse(raw) as unknown
    // Filename is the source of truth for id — backfill if a hand-edit omits it.
    if (obj && typeof obj === 'object' && typeof (obj as { id?: unknown }).id !== 'string') {
      const name = file.split('/').pop() ?? file
      const derived = name.endsWith('.json') ? name.slice(0, -5) : name
      if (derived) (obj as { id: string }).id = derived
    }
    const res = HookConfigSchema.safeParse(obj)
    if (!res.success) {
      log.warn('hooks: invalid config file', {
        file,
        issues: res.error.issues.map((i) => `${i.path.join('.')}:${i.message}`),
      })
      return null
    }
    const hook = res.data as Hook
    hook.source = source
    if (projectId) hook.projectId = projectId
    else delete hook.projectId
    return hook
  } catch (err) {
    log.warn('hooks: failed to parse', {
      file,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

async function listFromDir(
  dir: string,
  source: HookSource,
  projectId: string | undefined,
): Promise<Hook[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('hooks: listFromDir failed', { dir, err: err instanceof Error ? err.message : String(err) })
    }
    return []
  }
  const hooks: Hook[] = []
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    const file = join(dir, name)
    try {
      // eslint-disable-next-line no-await-in-loop
      const raw = await readFile(file, 'utf8')
      const hook = parse(raw, file, source, projectId)
      if (hook) hooks.push(hook)
    } catch (err) {
      log.warn('hooks: failed to read file', { file, err: err instanceof Error ? err.message : String(err) })
    }
  }
  return hooks
}

// ─── Trust (project tier, D-8) ───────────────────────────────────────────────
//
// Bản ghi trust KHÔNG nằm trong repo (đính chính bảo mật 2026-09-07, cùng lớp
// với finding F1 của ADR 0080).
//
// Sai ở đâu. D-8 đúng ý định — "một config không được tự phong tin cho chính
// nó" — nên trust được tách khỏi hook file. Nhưng nó lại được đặt vào
// `{project}/.awog/.trust.json`, tức CÙNG REPO với hook nó bảo lãnh
// (`{project}/.awog/hooks/*.json`). Ai commit được hook độc hại thì commit luôn
// bản ghi trust cho nó ⇒ clone repo là hook chạy shell không hỏi. Repo tự bảo
// lãnh cho chính mình, chỉ cao hơn đúng một tầng. `.gitignore` của repo AWOG có
// che `.awog/.trust.json`, nhưng đó chỉ là dogfooding — repo của người khác
// không có dòng đó.
//
// Vá. Trust chuyển sang AWOG home, khoá theo băm đường dẫn tuyệt đối:
//   ~/.awog/hook-trust/<sha256(resolve(projectPath)).hex[0..32]>.json
// Y hệt tầng project của luật quyền (`sessions/permission-rules.ts`) — cố ý
// không phát minh cách thứ hai:
//   - ổn định theo đường dẫn (`/p`, `/p/`, `/p/src/..` ⇒ cùng một file);
//   - tên file an toàn theo cấu tạo (chỉ `[0-9a-f]`) — hàm KHÔNG BAO GIỜ nhận
//     đường dẫn thô làm tên file ⇒ không có đường path traversal;
//   - một chiều: liệt kê thư mục không lộ danh sách project. `projectPath` ghi
//     BÊN TRONG file chỉ để người đọc nhận ra file của dự án nào, không bao giờ
//     dùng để giải ngược ra đường dẫn.
// Ngữ nghĩa đổi từ "duyệt cho dự án này, đi theo repo" thành **"duyệt cho dự án
// này TRÊN MÁY NÀY"**. Đổi tên / di chuyển thư mục project ⇒ khoá khác ⇒ trust
// cũ hết hiệu lực và hook phải hỏi lại (fail-safe: thà hỏi thừa còn hơn chạy
// shell của một thư mục khác).

const TRUST_DIR_NAME = sanitizeChild('hook-trust')

// null khi đường dẫn không tuyệt đối — caller coi như "chưa duyệt gì" (fail-safe).
export function hookTrustFile(projectPath: string): string | null {
  if (!projectPath || !isAbsolute(projectPath)) return null
  // `resolve` gộp `.`/`..` và bỏ dấu `/` thừa ⇒ nhiều cách viết cùng một project
  // cho ra cùng một khoá.
  const normalized = resolve(projectPath)
  const key = createHash('sha256').update(normalized).digest('hex').slice(0, 32)
  return join(awogHome(), TRUST_DIR_NAME, `${key}.json`)
}

// Vị trí CŨ (trong repo) — chỉ còn dùng để cảnh báo, không bao giờ để nạp.
function legacyTrustFile(projectPath: string): string {
  return join(projectPath, '.awog', TRUST_FILE)
}

const LEGACY_TRUST_WARNED = new Set<string>()

// Cảnh báo đúng một lần mỗi project mỗi tiến trình nếu còn bản ghi trust cũ nằm
// trong repo. KHÔNG migrate: chính nội dung đó là thứ không đáng tin (bất kỳ ai
// commit vào repo cũng ghi được), nên migrate im lặng chỉ là giữ nguyên lỗ hổng
// dưới một cái tên khác. Ai thật sự muốn giữ quyết định đó phải tự duyệt lại —
// tức là phải ĐỌC nó.
async function warnLegacyTrustFile(projectPath: string): Promise<void> {
  if (LEGACY_TRUST_WARNED.has(projectPath)) return
  LEGACY_TRUST_WARNED.add(projectPath)
  const legacy = legacyTrustFile(projectPath)
  try {
    await stat(legacy)
  } catch {
    return
  }
  log.warn(
    'hooks: in-repo trust file IGNORED (a trust record committed to a repo is untrusted); hook trust now lives in AWOG home — re-approve the hooks to grant it again',
    { legacy, current: hookTrustFile(projectPath) },
  )
}

async function readTrustedIds(projectPath: string): Promise<Set<string>> {
  await warnLegacyTrustFile(projectPath)
  const file = hookTrustFile(projectPath)
  if (!file) return new Set()
  try {
    const raw = await readFile(file, 'utf8')
    const obj = JSON.parse(raw) as { hooks?: unknown }
    const ids = Array.isArray(obj.hooks) ? obj.hooks.filter((x): x is string => typeof x === 'string') : []
    return new Set(ids)
  } catch (err) {
    // File hỏng ⇒ coi như CHƯA duyệt gì, không ném: hỏng ở đây fail-safe theo
    // chiều đóng (hook không chạy, người dùng duyệt lại), khác file luật quyền
    // nơi mất nội dung là mất DENY — nên ở đây không cần cấm ghi đè như F2.
    if (!isMissing(err)) {
      log.warn('hooks: failed to read trust file, treating the project as untrusted', {
        file,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    return new Set()
  }
}

// Mark project-tier hooks trusted (additive). Global hooks need no entry.
export async function setHookTrust(projectId: string, hookIds: string[]): Promise<void> {
  const project = await loadProject(projectId)
  if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
  const file = hookTrustFile(project.path)
  if (!file) throw new RpcError(-32602, `Project path is not absolute: ${projectId}`)
  const existing = await readTrustedIds(project.path)
  hookIds.forEach((id) => existing.add(id))
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  // `projectPath` là ghi chú cho người mở thư mục băm; khoá luôn tính lại từ
  // đường dẫn thật lúc đọc, không bao giờ giải ngược từ field này.
  const doc = { version: 1, projectPath: project.path, hooks: [...existing] }
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

// ─── Public read API ──────────────────────────────────────────────────────────

// Full listing for the UI: tags location, resolves trust, attaches recent runs,
// and reports each scanned dir (mirrors listSkills → { skills, reports }).
export async function listHooks(
  projectIds: string[] = [],
): Promise<{ hooks: Hook[]; reports: HookScanReport[] }> {
  const reports: HookScanReport[] = []

  const global = await listFromDir(globalHooksDir(), 'global', undefined)
  global.forEach((h) => {
    h.trusted = true
  })
  reports.push({ dir: globalHooksDir(), source: 'global', found: global.length })

  const projectResults = await Promise.all(
    projectIds.map(async (id) => {
      const project = await loadProject(id)
      if (!project) return []
      const dir = projectHooksDir(project.path)
      const native = await listFromDir(dir, 'project', id)
      const trusted = await readTrustedIds(project.path)
      native.forEach((h) => {
        h.trusted = trusted.has(h.id)
      })
      reports.push({ dir, source: 'project', found: native.length, projectId: id })
      return native
    }),
  )

  const hooks = [...global, ...projectResults.flat()]
  // Attach recent runs (last N) for the detail view.
  await Promise.all(
    hooks.map(async (h) => {
      h.recentRuns = (await listRunRecords(h.id, h.source ?? 'global', h.projectId))
        .slice(-RECENT_RUNS_SHOWN)
        .reverse()
    }),
  )
  hooks.sort((a, b) => a.name.localeCompare(b.name))
  return { hooks, reports }
}

// Enabled + trusted hooks for global + the given project — the dispatcher's
// source set (it filters by event/matcher). No run records (hot path).
export async function listEnabledHooksForDispatch(projectId: string | undefined): Promise<Hook[]> {
  const global = (await listFromDir(globalHooksDir(), 'global', undefined)).filter((h) => h.enabled)
  global.forEach((h) => {
    h.trusted = true
  })
  if (!projectId) return global
  const project = await loadProject(projectId)
  if (!project) return global
  const trusted = await readTrustedIds(project.path)
  const projHooks = (await listFromDir(projectHooksDir(project.path), 'project', projectId)).filter(
    (h) => h.enabled,
  )
  projHooks.forEach((h) => {
    h.trusted = trusted.has(h.id)
  })
  return [...global, ...projHooks]
}

export async function loadHook(
  id: string,
  source: HookSource = 'global',
  projectId?: string,
): Promise<Hook | null> {
  const dir = await resolveHooksDir(source, projectId)
  try {
    const raw = await readFile(hookFile(dir, id), 'utf8')
    return parse(raw, hookFile(dir, id), source, projectId)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

// Resolve a hook's env `secret:KEY` refs to plaintext, namespaced by hook id.
export async function expandHookEnv(hook: Hook): Promise<Record<string, string>> {
  return expandSecrets(hook.id, hook.env)
}

// ─── Public write API ──────────────────────────────────────────────────────────

export async function saveHook(hook: Hook): Promise<void> {
  const source = hook.source ?? 'global'
  const dir = await resolveHooksDir(source, hook.projectId)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  // Persist config fields only — location/runtime fields are derived.
  const persisted = {
    id: hook.id,
    name: hook.name,
    description: hook.description,
    event: hook.event,
    matcher: hook.matcher,
    command: hook.command,
    cwd: hook.cwd,
    timeoutMs: hook.timeoutMs,
    runMode: hook.runMode,
    enabled: hook.enabled,
    ...(hook.env ? { env: hook.env } : {}),
  }
  const file = hookFile(dir, hook.id)
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(persisted, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

export async function deleteHook(
  id: string,
  source: HookSource = 'global',
  projectId?: string,
): Promise<void> {
  // Purge any keychain secrets the hook referenced (best-effort).
  const existing = await loadHook(id, source, projectId).catch(() => null)
  if (existing?.env) await purgeServerSecrets(id, existing.env, undefined)
  const dir = await resolveHooksDir(source, projectId)
  try {
    await unlink(hookFile(dir, id))
  } catch (err) {
    if (!isMissing(err)) throw err
  }
}

// ─── Run audit log (JSONL, append-only, trimmed on read) ─────────────────────

function runsDir(): string {
  return join(globalHooksDir(), RUNS_DIR_NAME)
}

// Run logs are scoped by tier. A project-tier id is only unique WITHIN its
// project — two projects that import the same Claude Code settings.json both get
// e.g. `imported-posttooluse-0-0`, so a flat `<id>.jsonl` would mix their runs
// together (every project's "Recent runs" looks identical). Namespace project
// runs by projectId; global ids are already unique → flat (back-compat).
function runLogFile(id: string, source: HookSource, projectId: string | undefined): string {
  if (source === 'project' && projectId) {
    return join(runsDir(), sanitizeChild(projectId), `${sanitizeChild(id)}.jsonl`)
  }
  return join(runsDir(), `${sanitizeChild(id)}.jsonl`)
}

export async function appendRunRecord(
  id: string,
  source: HookSource,
  projectId: string | undefined,
  record: HookRunRecord,
): Promise<void> {
  const file = runLogFile(id, source, projectId)
  try {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8')
  } catch (err) {
    log.warn('hooks: failed to append run record', { id, err: err instanceof Error ? err.message : String(err) })
  }
}

export async function listRunRecords(
  id: string,
  source: HookSource,
  projectId: string | undefined,
): Promise<HookRunRecord[]> {
  const file = runLogFile(id, source, projectId)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    if (isMissing(err)) return []
    log.warn('hooks: failed to read run log', { id, err: err instanceof Error ? err.message : String(err) })
    return []
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  const records: HookRunRecord[] = []
  for (const line of lines) {
    try {
      records.push(JSON.parse(line) as HookRunRecord)
    } catch {
      // skip a corrupt line
    }
  }
  // Trim the file lazily once it grows past the cap (keep the newest RUN_LOG_MAX).
  if (records.length > RUN_LOG_MAX) {
    const kept = records.slice(-RUN_LOG_MAX)
    const tmp = `${file}.tmp.${process.pid}`
    try {
      await writeFile(tmp, `${kept.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8')
      await rename(tmp, file)
    } catch {
      // best-effort trim; keep serving the in-memory slice
    }
    return kept
  }
  return records
}
