// Project Template persistence (ADR 0036). A template is a self-contained bundle
// under ~/.awog/templates/<id>/ holding a manifest (template.json) + a copy of
// each included config entity in its `.awog` on-disk layout:
//
//   ~/.awog/templates/<id>/template.json
//   ~/.awog/templates/<id>/agents/<id>.md        (or agents/<id>/AGENT.md)
//   ~/.awog/templates/<id>/skills/<id>/SKILL.md
//   ~/.awog/templates/<id>/hooks/<id>.json
//   ~/.awog/templates/<id>/rules/<id>.md
//   ~/.awog/templates/<id>/commands/<ns>/<id>.md
//
// create() copies entities OUT of `.awog`; install() copies them INTO a target
// project's `.awog` tiers. Both are plain file copies (faithful — preserves
// colocated siblings + exact format). Security (ADR 0036 D-7): imported hooks
// land untrusted (no .trust.json), secret values are never copied.

import { cp, mkdir, readdir, readFile, rm, stat, writeFile, rename } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'
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

// `.awog/<kind>s` dir for a scope (source of truth for create, target for install).
async function awogKindDir(kind: ConfigKind, scope: Scope, projectId?: string): Promise<string> {
  const sub = `${kind}s`
  if (scope === 'global') return join(awogHome(), sub)
  if (!projectId) throw new RpcError(-32602, `Project ${kind} requires a projectId`)
  const project = await loadProject(projectId)
  if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
  return join(project.path, '.awog', sub)
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

function parseManifest(raw: string, id: string): ProjectTemplate | null {
  try {
    const obj = JSON.parse(raw) as Partial<ProjectTemplate>
    if (typeof obj.name !== 'string') return null
    return {
      id,
      name: obj.name,
      description: typeof obj.description === 'string' ? obj.description : '',
      createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : '',
      ...(typeof obj.sourceProjectId === 'string' ? { sourceProjectId: obj.sourceProjectId } : {}),
      entities: Array.isArray(obj.entities) ? (obj.entities as TemplateEntityRef[]) : [],
    }
  } catch {
    return null
  }
}

export async function listTemplates(): Promise<ProjectTemplate[]> {
  let entries: string[]
  try {
    entries = await readdir(templatesRoot())
  } catch {
    return []
  }
  const out: ProjectTemplate[] = []
  for (const id of entries) {
    if (id.startsWith('.')) continue
    // eslint-disable-next-line no-await-in-loop
    if (!(await isDir(templateDir(id)))) continue
    try {
      // eslint-disable-next-line no-await-in-loop
      const raw = await readFile(manifestFile(id), 'utf8')
      const t = parseManifest(raw, id)
      if (t) out.push(t)
    } catch {
      // skip a template with no/broken manifest
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export async function getTemplate(id: string): Promise<ProjectTemplate | null> {
  try {
    const raw = await readFile(manifestFile(id), 'utf8')
    return parseManifest(raw, id)
  } catch {
    return null
  }
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
  const awogRoot = join(project.path, '.awog')
  const installed: TemplateInstallResult['installed'] = []
  const skipped: TemplateInstallResult['skipped'] = []
  for (const ref of template.entities) {
    const src = join(bundleRoot, ref.file)
    // Target mirrors the bundle layout under {project}/.awog/.
    const dest = join(awogRoot, ref.file)
    // Defense in depth (invariant #2): a hand-edited/shared template.json must
    // not point ref.file outside the bundle or the project's `.awog`.
    if (!isInside(src, bundleRoot) || !isInside(dest, awogRoot)) {
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
