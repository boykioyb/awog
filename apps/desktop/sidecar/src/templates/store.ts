// Project Template persistence (ADR 0036). A template is a self-contained bundle
// under ~/.awog/templates/<id>/ holding a manifest (template.json) + a copy of
// each included config entity in its on-disk layout:
//
//   ~/.awog/templates/<id>/template.json
//   ~/.awog/templates/<id>/agents/<id>.md        (or agents/<id>/AGENT.md)
//   ~/.awog/templates/<id>/skills/<id>/SKILL.md
//   ~/.awog/templates/<id>/hooks/<id>.json
//   ~/.awog/templates/<id>/rules/<id>.md
//   ~/.awog/templates/<id>/commands/<ns>/<id>.md
//
// create() copies entities OUT of their home; install() copies them INTO the
// target project's matching tier — `.claude` for agents/skills/commands, `.awog`
// for hooks/rules (ADR 0070). Both are plain file copies (faithful — preserves
// colocated siblings + exact format). Security (ADR 0036 D-7): imported hooks
// land untrusted (no .trust.json), secret values are never copied.

import { randomBytes } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile, rename } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { z } from 'zod'
import { awogHome, claudeHome, projectClaudeDir, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'
import { readInstallMeta, type InstalledTemplate } from './install-meta.js'
import type {
  ConfigKind,
  ProjectTemplate,
  TemplateEntityRef,
  TemplateInstallResult,
} from '../types/shared.js'

type Scope = 'global' | 'project'

export interface CreateEntityRef {
  kind: ConfigKind
  id: string
  source: Scope
  projectId?: string
}

function templatesRoot(): string {
  return join(awogHome(), 'templates')
}

export function templateDir(id: string): string {
  return join(templatesRoot(), sanitizeChild(id))
}

export function manifestFile(id: string): string {
  return join(templateDir(id), 'template.json')
}

// Thư mục dựng tạm, NẰM CÙNG CHA với bundle thật (rename chỉ atomic trong cùng
// filesystem) và bắt đầu bằng '.' nên listTemplates() bỏ qua.
function scratchDir(kind: 'staging' | 'backup', id: string): string {
  const rand = randomBytes(4).toString('hex')
  return join(templatesRoot(), `.${kind}-${sanitizeChild(id)}-${process.pid}-${rand}`)
}

export function stagingDir(id: string): string {
  return scratchDir('staging', id)
}

// Thay bundle bằng bản dựng sẵn ở `staging` qua 2 lần rename. Không bao giờ
// `rm -rf` bản đang dùng trước khi bản mới sẵn sàng: rename thứ 2 hỏng thì bản
// cũ được trả lại nguyên vẹn, nên không có trạng thái nửa vời.
export async function swapBundle(staging: string, id: string): Promise<void> {
  const target = templateDir(id)
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  const backup = scratchDir('backup', id)
  const hadOld = await isDir(target)
  if (hadOld) await rename(target, backup)
  try {
    await rename(staging, target)
  } catch (err) {
    if (hadOld) await rename(backup, target)
    throw err
  }
  if (hadOld) await rm(backup, { recursive: true, force: true })
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

// True iff `child` resolves to `root` or a path inside it (path-traversal guard).
export function isInside(child: string, root: string): boolean {
  const c = resolve(child)
  const r = resolve(root)
  return c === r || c.startsWith(r + sep)
}

// Which home a kind lives in. agents/skills/commands are SHARED with the Claude
// Code CLI under `.claude`; hooks/rules stay AWOG-owned under `.awog` (ADR 0070).
function isSharedKind(kind: ConfigKind): boolean {
  return kind === 'agent' || kind === 'skill' || kind === 'command'
}

// The home root a kind's entities live under, for one scope.
function kindHome(kind: ConfigKind, projectPath?: string): string {
  if (projectPath) {
    return isSharedKind(kind) ? projectClaudeDir(projectPath) : join(projectPath, '.awog')
  }
  return isSharedKind(kind) ? claudeHome() : awogHome()
}

// `<home>/<kind>s` dir for a scope (source of truth for create, target for install).
async function awogKindDir(kind: ConfigKind, scope: Scope, projectId?: string): Promise<string> {
  const sub = `${kind}s`
  if (scope === 'global') return join(kindHome(kind), sub)
  if (!projectId) throw new RpcError(-32602, `Project ${kind} requires a projectId`)
  const project = await loadProject(projectId)
  if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
  return join(kindHome(kind, project.path), sub)
}

// Slug → unique template id (append -2, -3… if the dir already exists).
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return base || 'template'
}

async function uniqueTemplateId(name: string): Promise<string> {
  const base = slugify(name)
  let id = base
  let n = 2
  // eslint-disable-next-line no-await-in-loop
  while (await fileExists(templateDir(id))) {
    id = `${base}-${n}`
    n += 1
  }
  return id
}

// The on-disk entity ROOT relative to a `.awog/<kind>s` dir, plus whether it is a
// directory. Returns null if the entity does not exist on disk.
async function entityRoot(
  kind: ConfigKind,
  id: string,
  baseDir: string,
): Promise<{ rel: string; abs: string; dir: boolean } | null> {
  if (kind === 'agent') {
    const folder = join(baseDir, sanitizeChild(id))
    if (await fileExists(join(folder, 'AGENT.md'))) return { rel: id, abs: folder, dir: true }
    const file = join(baseDir, `${sanitizeChild(id)}.md`)
    if (await fileExists(file)) return { rel: `${id}.md`, abs: file, dir: false }
    return null
  }
  if (kind === 'skill') {
    const folder = join(baseDir, sanitizeChild(id))
    if (await fileExists(join(folder, 'SKILL.md'))) return { rel: id, abs: folder, dir: true }
    return null
  }
  if (kind === 'hook') {
    const file = join(baseDir, `${sanitizeChild(id)}.json`)
    if (await fileExists(file)) return { rel: `${id}.json`, abs: file, dir: false }
    return null
  }
  // rule + command are single .md; commands namespace with ':' → subdirs.
  const rel = kind === 'command' ? `${id.split(':').map(sanitizeChild).join('/')}.md` : `${sanitizeChild(id)}.md`
  const file = join(baseDir, rel)
  if (await fileExists(file)) return { rel, abs: file, dir: false }
  return null
}

// ─── Public read API ──────────────────────────────────────────────────────────

// `template.json` là nội dung L1 (tải từ GitHub hoặc sửa tay) nên entity phải
// qua schema, không ép kiểu. `file` bị chặn path traversal ngay tại biên: entity
// nào có path không an toàn thì bị LOẠI, thay vì phó mặc cho isInside() ở dưới.
export function isSafeBundleRelPath(rel: string): boolean {
  if (!rel || rel.length > 1024) return false
  if (rel.includes('\\') || rel.includes('\0')) return false
  if (rel.startsWith('/')) return false
  // Ổ đĩa Windows ('C:/…') — join() trên POSIX giữ nguyên nhưng vẫn là path lạ.
  if (/^[A-Za-z]:/.test(rel)) return false
  return rel.split('/').every((seg) => seg.length > 0 && seg !== '.' && seg !== '..')
}

const EntityRefSchema = z.object({
  kind: z.enum(['agent', 'skill', 'hook', 'rule', 'command']),
  id: z.string().min(1).max(256),
  file: z.string().min(1).max(1024).refine(isSafeBundleRelPath, 'unsafe bundle path'),
})

const ManifestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  createdAt: z.string().max(64).optional(),
  version: z.string().max(120).optional(),
  sourceProjectId: z.string().max(64).optional(),
  entities: z.array(z.unknown()).max(1000).optional(),
})

function parseManifest(raw: string, id: string): InstalledTemplate | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = ManifestSchema.safeParse(json)
  if (!parsed.success) return null
  const m = parsed.data
  const entities: TemplateEntityRef[] = []
  for (const candidate of m.entities ?? []) {
    const ref = EntityRefSchema.safeParse(candidate)
    if (ref.success) entities.push(ref.data)
    else log.warn('templates: dropping invalid entity ref in manifest', { id })
  }
  return {
    id,
    name: m.name,
    description: m.description ?? '',
    createdAt: m.createdAt ?? '',
    ...(m.version ? { version: m.version } : {}),
    ...(m.sourceProjectId ? { sourceProjectId: m.sourceProjectId } : {}),
    entities,
  }
}

// Gắn provenance (`.install.json`) vào template đọc từ manifest. Bundle export
// tại chỗ không có file này ⇒ không có sourceUrl ⇒ UI ẩn nút cập nhật.
async function withInstallMeta(tpl: InstalledTemplate): Promise<InstalledTemplate> {
  const meta = await readInstallMeta(templateDir(tpl.id))
  if (!meta) return tpl
  const version = tpl.version ?? meta.version
  return {
    ...tpl,
    ...(version ? { version } : {}),
    sourceUrl: meta.sourceUrl,
    sourceRef: meta.sourceRef,
    installedAt: meta.installedAt,
    ...(meta.homepage ? { homepage: meta.homepage } : {}),
  }
}

export async function listTemplates(): Promise<InstalledTemplate[]> {
  let entries: string[]
  try {
    entries = await readdir(templatesRoot())
  } catch {
    return []
  }
  const out: InstalledTemplate[] = []
  for (const id of entries) {
    if (id.startsWith('.')) continue
    // eslint-disable-next-line no-await-in-loop
    if (!(await isDir(templateDir(id)))) continue
    try {
      // eslint-disable-next-line no-await-in-loop
      const raw = await readFile(manifestFile(id), 'utf8')
      const t = parseManifest(raw, id)
      // eslint-disable-next-line no-await-in-loop
      if (t) out.push(await withInstallMeta(t))
    } catch {
      // skip a template with no/broken manifest
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export async function getTemplate(id: string): Promise<InstalledTemplate | null> {
  let raw: string
  try {
    raw = await readFile(manifestFile(id), 'utf8')
  } catch {
    return null
  }
  const tpl = parseManifest(raw, id)
  return tpl ? await withInstallMeta(tpl) : null
}

// ─── Create (export from `.awog`) ──────────────────────────────────────────────

export async function createTemplate(input: {
  name: string
  description: string
  sourceProjectId?: string
  entities: CreateEntityRef[]
}): Promise<ProjectTemplate> {
  const id = await uniqueTemplateId(input.name)
  const dir = templateDir(id)
  await mkdir(dir, { recursive: true, mode: 0o700 })

  const refs: TemplateEntityRef[] = []
  for (const e of input.entities) {
    // eslint-disable-next-line no-await-in-loop
    const baseDir = await awogKindDir(e.kind, e.source, e.projectId)
    // eslint-disable-next-line no-await-in-loop
    const root = await entityRoot(e.kind, e.id, baseDir)
    if (!root) {
      log.warn('templates: entity not found, skipping', { kind: e.kind, id: e.id })
      continue
    }
    const bundleRel = `${e.kind}s/${root.rel}`
    const dest = join(dir, bundleRel)
    // eslint-disable-next-line no-await-in-loop
    await mkdir(join(dest, '..'), { recursive: true, mode: 0o700 })
    // eslint-disable-next-line no-await-in-loop
    await cp(root.abs, dest, { recursive: root.dir, force: true })
    refs.push({ kind: e.kind, id: e.id, file: bundleRel })
  }

  const template: ProjectTemplate = {
    id,
    name: input.name,
    description: input.description,
    createdAt: new Date().toISOString(),
    ...(input.sourceProjectId ? { sourceProjectId: input.sourceProjectId } : {}),
    entities: refs,
  }
  const tmp = `${manifestFile(id)}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(template, null, 2), 'utf8')
  await rename(tmp, manifestFile(id))
  return template
}

// ─── Install (copy into a project's `.awog`) ────────────────────────────────────

export async function installTemplate(
  templateId: string,
  targetProjectId: string,
  conflictPolicy: 'skip' | 'overwrite' = 'skip',
): Promise<TemplateInstallResult> {
  const template = await getTemplate(templateId)
  if (!template) throw new RpcError(-32602, `Template not found: ${templateId}`)
  const project = await loadProject(targetProjectId)
  if (!project) throw new RpcError(-32602, `Project not found: ${targetProjectId}`)

  const bundleRoot = templateDir(templateId)
  const installed: TemplateInstallResult['installed'] = []
  const skipped: TemplateInstallResult['skipped'] = []
  for (const ref of template.entities) {
    const src = join(bundleRoot, ref.file)
    // Target mirrors the bundle layout under the kind's home in the project:
    // {project}/.claude for agents/skills/commands, {project}/.awog for the rest.
    const destRoot = kindHome(ref.kind, project.path)
    const dest = join(destRoot, ref.file)
    // Defense in depth (invariant #2): a hand-edited/shared template.json must
    // not point ref.file outside the bundle or that home.
    if (!isInside(src, bundleRoot) || !isInside(dest, destRoot)) {
      skipped.push({ kind: ref.kind, id: ref.id, reason: 'unsafe path in manifest' })
      continue
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const srcIsDir = await isDir(src)
      // eslint-disable-next-line no-await-in-loop
      if ((await fileExists(dest)) && conflictPolicy === 'skip') {
        skipped.push({ kind: ref.kind, id: ref.id, reason: 'already exists' })
        continue
      }
      // eslint-disable-next-line no-await-in-loop
      await mkdir(join(dest, '..'), { recursive: true, mode: 0o700 })
      // eslint-disable-next-line no-await-in-loop
      await cp(src, dest, { recursive: srcIsDir, force: true })
      installed.push({ kind: ref.kind, id: ref.id })
    } catch (err) {
      log.warn('templates: install entity failed', {
        templateId,
        ref,
        err: err instanceof Error ? err.message : String(err),
      })
      skipped.push({
        kind: ref.kind,
        id: ref.id,
        reason: err instanceof Error ? err.message : 'install failed',
      })
    }
  }
  return { installed, skipped }
}

export async function deleteTemplate(id: string): Promise<void> {
  await rm(templateDir(id), { recursive: true, force: true })
}
