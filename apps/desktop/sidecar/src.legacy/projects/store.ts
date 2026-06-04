// Project metadata persistence. Each project lives in its own JSON file at
// ~/.awog/projects/<id>.json — see ADR 0012. Update = atomic rewrite via .tmp
// + rename. Delete = unlink (the on-disk codebase is never touched).

import { mkdir, readdir, readFile, writeFile, chmod, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import type { Project } from '../types/shared.js'

const PROJECTS_DIR_NAME = sanitizeChild('projects')

function projectsDir(): string {
  return join(awogHome(), PROJECTS_DIR_NAME)
}

function projectFile(id: string): string {
  const safe = sanitizeChild(id)
  return join(projectsDir(), `${safe}.json`)
}

async function ensureDir(): Promise<void> {
  await mkdir(projectsDir(), { recursive: true, mode: 0o700 })
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

function parse(raw: string, file: string): Project | null {
  try {
    const obj = JSON.parse(raw) as unknown
    if (!obj || typeof obj !== 'object') return null
    const p = obj as Record<string, unknown>
    if (typeof p.id !== 'string' || typeof p.name !== 'string') return null
    return obj as Project
  } catch (err) {
    log.warn('projects: failed to parse', {
      file,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

export async function loadProject(id: string): Promise<Project | null> {
  const file = projectFile(id)
  try {
    const raw = await readFile(file, 'utf8')
    return parse(raw, file)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

export async function listProjects(): Promise<Project[]> {
  let entries: string[]
  try {
    entries = await readdir(projectsDir())
  } catch (err) {
    if (isMissing(err)) return []
    throw err
  }
  const projects: Project[] = []
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    const file = join(projectsDir(), name)
    try {
      // eslint-disable-next-line no-await-in-loop
      const raw = await readFile(file, 'utf8')
      const snap = parse(raw, file)
      if (snap) projects.push(snap)
    } catch (err) {
      log.warn('projects: failed to read file', {
        file,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  // Newest first by createdAt (ISO-8601 lexicographic). Falls back to name for ties.
  projects.sort((a, b) => {
    if (a.createdAt === b.createdAt) return a.name.localeCompare(b.name)
    return a.createdAt < b.createdAt ? 1 : -1
  })
  return projects
}

export async function saveProject(project: Project): Promise<void> {
  await ensureDir()
  const file = projectFile(project.id)
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(project, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

export async function deleteProject(id: string): Promise<void> {
  const file = projectFile(id)
  try {
    await unlink(file)
  } catch (err) {
    if (isMissing(err)) return
    throw err
  }
}
