// AI memory persistence (ADR 0073 part B). One fact per file, two tiers:
//
//   global  → ~/.awog/memory/<slug>.md              (applies everywhere)
//   project → {project.path}/.awog/memory/<slug>.md  (that project only)
//
// Frontmatter: name, description, type, enabled. There is deliberately NO
// `MEMORY.md` index on disk (D-10): the injected index is derived from these
// frontmatters, because a second file listing the same facts would drift out of
// sync the first time someone edited one and not the other.
//
// `description` is the fact stated in ONE LINE — it is what reaches the prompt.
// `body` is optional detail the model pulls with `memory_read`. That split is why
// index-only injection still delivers the fact instead of just its title.

import { chmod, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'
import { parseFrontmatter, serializeFrontmatter } from '../skills/frontmatter.js'
import type { MemoryFact, MemorySource, MemoryType } from '../types/shared.js'

const MEMORY_DIR_NAME = sanitizeChild('memory')
const MAX_FACT_BYTES = 64 * 1024
const MAX_FACTS_PER_TIER = 500

const TYPES: readonly MemoryType[] = ['user', 'feedback', 'project', 'reference']

function globalMemoryDir(): string {
  return join(awogHome(), MEMORY_DIR_NAME)
}

function projectMemoryDir(projectPath: string): string {
  return join(projectPath, '.awog', MEMORY_DIR_NAME)
}

async function resolveMemoryDir(
  source: MemorySource,
  projectId: string | undefined,
): Promise<string> {
  if (source === 'global') return globalMemoryDir()
  if (!projectId) throw new RpcError(-32602, 'Project memory requires a projectId')
  const project = await loadProject(projectId)
  if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
  return projectMemoryDir(project.path)
}

// A memory slug comes from the model (`memory_remember`) as often as from the UI,
// so it is L1-untrusted: derive a safe filename instead of trusting the input.
// `sanitizeChild` is the backstop — this makes the common case (a sentence-ish
// name) produce something readable rather than throwing.
export function memorySlug(name: string): string {
  const slug = String(name ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/[.-]+$/, '')
    .toLowerCase()
    .slice(0, 80)
  if (!slug) throw new RpcError(-32602, `Memory name has no usable characters: ${name}`)
  return sanitizeChild(slug)
}

function factFile(dir: string, id: string): string {
  return join(dir, `${sanitizeChild(id)}.md`)
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

function asString(value: string | string[] | undefined, fallback = ''): string {
  if (Array.isArray(value)) return value.join(', ')
  return value ?? fallback
}

function asType(value: string | string[] | undefined): MemoryType {
  const raw = asString(value, 'project').toLowerCase()
  return (TYPES as readonly string[]).includes(raw) ? (raw as MemoryType) : 'project'
}

function parse(
  raw: string,
  id: string,
  source: MemorySource,
  projectId: string | undefined,
  updatedAt: number,
): MemoryFact {
  const { data, body } = parseFrontmatter(raw)
  const fact: MemoryFact = {
    id,
    source,
    name: asString(data.name, id),
    description: asString(data.description),
    body: body.trim(),
    type: asType(data.type),
    // enabled defaults true; only an explicit "false" disables.
    enabled: asString(data.enabled, 'true').toLowerCase() !== 'false',
    updatedAt,
  }
  if (projectId) fact.projectId = projectId
  return fact
}

async function listFromDir(
  dir: string,
  source: MemorySource,
  projectId: string | undefined,
): Promise<MemoryFact[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('memory: listFromDir failed', {
        dir,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    return []
  }
  const facts: MemoryFact[] = []
  for (const name of entries) {
    if (!name.endsWith('.md') || name.startsWith('.')) continue
    const file = join(dir, name)
    try {
      // eslint-disable-next-line no-await-in-loop
      const st = await stat(file)
      if (st.size > MAX_FACT_BYTES) {
        log.warn('memory: skipping oversized fact', { file, bytes: st.size })
        continue
      }
      // eslint-disable-next-line no-await-in-loop
      const raw = await readFile(file, 'utf8')
      facts.push(parse(raw, name.slice(0, -3), source, projectId, st.mtimeMs))
    } catch (err) {
      log.warn('memory: failed to read fact', {
        file,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return facts
}

export interface MemoryScanReport {
  dir: string
  source: MemorySource
  projectId?: string
  found: number
}

export async function listMemory(
  projectIds: readonly string[] = [],
): Promise<{ facts: MemoryFact[]; reports: MemoryScanReport[] }> {
  const reports: MemoryScanReport[] = []
  const global = await listFromDir(globalMemoryDir(), 'global', undefined)
  reports.push({ dir: globalMemoryDir(), source: 'global', found: global.length })

  const perProject = await Promise.all(
    projectIds.map(async (id) => {
      const project = await loadProject(id)
      if (!project) return []
      const dir = projectMemoryDir(project.path)
      const facts = await listFromDir(dir, 'project', id)
      reports.push({ dir, source: 'project', found: facts.length, projectId: id })
      return facts
    }),
  )

  // Sort by type priority, then most recently touched first — the order the index
  // uses, so what the user sees in Settings matches what the model reads.
  const order = new Map(TYPES.map((t, i) => [t, i]))
  const facts = [...global, ...perProject.flat()].sort((a, b) => {
    const byType = (order.get(a.type) ?? 9) - (order.get(b.type) ?? 9)
    return byType !== 0 ? byType : b.updatedAt - a.updatedAt
  })
  return { facts, reports }
}

export async function listEnabledMemory(projectId: string | undefined): Promise<MemoryFact[]> {
  const ids = projectId ? [projectId] : []
  const { facts } = await listMemory(ids)
  return facts.filter((f) => f.enabled)
}

export async function loadFact(
  id: string,
  source: MemorySource = 'global',
  projectId?: string,
): Promise<MemoryFact | null> {
  const dir = await resolveMemoryDir(source, projectId)
  const file = factFile(dir, id)
  try {
    const st = await stat(file)
    const raw = await readFile(file, 'utf8')
    return parse(raw, id, source, projectId, st.mtimeMs)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

export interface SaveMemoryInput {
  id?: string | undefined
  source: MemorySource
  projectId?: string | undefined
  name: string
  description: string
  body?: string | undefined
  type?: MemoryType | undefined
  enabled?: boolean | undefined
}

export async function saveFact(input: SaveMemoryInput): Promise<MemoryFact> {
  const dir = await resolveMemoryDir(input.source, input.projectId)
  const id = input.id ? sanitizeChild(input.id) : memorySlug(input.name)

  // Cap the tier so a looping agent cannot fill the directory. Only enforced for a
  // NEW fact — overwriting an existing one is always allowed.
  const file = factFile(dir, id)
  const exists = await stat(file).then(
    () => true,
    () => false,
  )
  if (!exists) {
    const current = await listFromDir(dir, input.source, input.projectId)
    if (current.length >= MAX_FACTS_PER_TIER) {
      throw new RpcError(
        -32602,
        `Memory is full (${MAX_FACTS_PER_TIER} facts). Delete some before adding more.`,
      )
    }
  }

  const content = serializeFrontmatter(
    {
      name: input.name,
      description: input.description,
      type: input.type ?? 'project',
      enabled: input.enabled === false ? 'false' : 'true',
    },
    input.body ?? '',
  )
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, content, 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)

  const st = await stat(file)
  const fact: MemoryFact = {
    id,
    source: input.source,
    name: input.name,
    description: input.description,
    body: (input.body ?? '').trim(),
    type: input.type ?? 'project',
    enabled: input.enabled !== false,
    updatedAt: st.mtimeMs,
  }
  if (input.projectId) fact.projectId = input.projectId
  return fact
}

export async function deleteFact(
  id: string,
  source: MemorySource = 'global',
  projectId?: string,
): Promise<void> {
  const dir = await resolveMemoryDir(source, projectId)
  try {
    await unlink(factFile(dir, id))
  } catch (err) {
    if (!isMissing(err)) throw err
  }
}

// Delete every fact in one tier ("forget everything"). Returns how many went.
export async function clearMemory(
  source: MemorySource,
  projectId?: string,
): Promise<{ deleted: number }> {
  const dir = await resolveMemoryDir(source, projectId)
  const facts = await listFromDir(dir, source, projectId)
  let deleted = 0
  for (const fact of facts) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await unlink(factFile(dir, fact.id))
      deleted += 1
    } catch (err) {
      if (!isMissing(err)) {
        log.warn('memory: clear failed for one fact', { id: fact.id })
      }
    }
  }
  return { deleted }
}

// Resolve a model-supplied name to an existing fact across the tiers in scope.
// The model remembers a NAME, not a slug, so accept either.
export async function findFact(
  nameOrId: string,
  projectId: string | undefined,
): Promise<MemoryFact | null> {
  const facts = (await listMemory(projectId ? [projectId] : [])).facts
  const wanted = nameOrId.trim().toLowerCase()
  let slug = ''
  try {
    slug = memorySlug(nameOrId)
  } catch {
    slug = ''
  }
  return (
    facts.find((f) => f.id === slug) ??
    facts.find((f) => f.name.toLowerCase() === wanted) ??
    facts.find((f) => f.id.toLowerCase() === wanted) ??
    null
  )
}
