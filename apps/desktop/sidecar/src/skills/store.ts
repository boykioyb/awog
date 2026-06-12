// Skill persistence. Each skill is a folder containing SKILL.md (YAML
// frontmatter + markdown body). Single editable home `.awog`, two tiers
// (ADR 0035):
//
//   global  → ~/.awog/skills/<id>/SKILL.md             (applies everywhere)
//   project → {project.path}/.awog/skills/<id>/SKILL.md (that project only)
//
// Same on-disk shape as Claude Code SDK / craft-agents-oss, so a skill written
// here is reusable outside AWOG and vice versa. `.claude`/`.agents` skill dirs
// are import sources only (see migration/).

import { mkdir, readdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js'
import { loadProject } from '../projects/store.js'
import type { Skill, SkillSource } from '../types/shared.js'

const SKILLS_DIR_NAME = sanitizeChild('skills')
const AWOG_DIR_NAME = sanitizeChild('.awog')

function userSkillsDir(): string {
  return join(awogHome(), SKILLS_DIR_NAME)
}

async function resolveSkillsDir(
  source: SkillSource,
  projectId: string | undefined,
): Promise<string> {
  if (source === 'global') return userSkillsDir()
  // source === 'project'
  if (!projectId) {
    throw new Error(`Source ${source} requires a projectId`)
  }
  const project = await loadProject(projectId)
  if (!project) {
    throw new Error(`Project not found: ${projectId}`)
  }
  return join(project.path, AWOG_DIR_NAME, SKILLS_DIR_NAME)
}

function skillFolder(dir: string, id: string): string {
  return join(dir, sanitizeChild(id))
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value)) {
    const out = value.filter((v): v is string => typeof v === 'string' && v.length > 0)
    return out.length > 0 ? out : undefined
  }
  if (typeof value === 'string' && value.length > 0) return [value]
  return undefined
}

function buildSkill(
  id: string,
  raw: string,
  source: SkillSource,
  projectId: string | undefined,
): Skill | null {
  const { data, body } = parseFrontmatter(raw)
  const name = typeof data.name === 'string' ? data.name : ''
  const description = typeof data.description === 'string' ? data.description : ''
  if (!name || !description) return null
  const skill: Skill = { id, source, name, description, body }
  if (projectId) skill.projectId = projectId
  const globs = toStringArray(data.globs)
  if (globs) skill.globs = globs
  const alwaysAllow = toStringArray(data.alwaysAllow)
  if (alwaysAllow) skill.alwaysAllow = alwaysAllow
  if (typeof data.icon === 'string' && data.icon.length > 0) skill.icon = data.icon
  const requiredSources = toStringArray(data.requiredSources)
  if (requiredSources) skill.requiredSources = requiredSources
  return skill
}

async function listFromDir(
  dir: string,
  source: SkillSource,
  projectId: string | undefined,
): Promise<Skill[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    // Any read failure — missing, no permission, dangling symlink, etc. — is
    // treated as "this tier yields no skills" rather than throwing. Otherwise a
    // single misbehaving directory would reject Promise.all and zero out the
    // whole list (including the user-level dirs that DO have content).
    if (!isMissing(err)) {
      log.warn('skills: listFromDir failed', {
        dir,
        source,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    return []
  }
  log.info('skills: scanning', { dir, source, entries: entries.length })
  const skills: Skill[] = []
  for (const name of entries) {
    const folder = join(dir, name)
    const file = join(folder, 'SKILL.md')
    try {
      // eslint-disable-next-line no-await-in-loop
      const s = await stat(folder)
      if (!s.isDirectory()) continue
      // eslint-disable-next-line no-await-in-loop
      const raw = await readFile(file, 'utf8')
      const skill = buildSkill(name, raw, source, projectId)
      if (skill) skills.push(skill)
      else log.warn('skills: SKILL.md missing required name/description', { file })
    } catch (err) {
      if (!isMissing(err)) {
        log.warn('skills: failed to read', {
          file,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  log.info('skills: scan result', { dir, source, found: skills.length })
  return skills
}

export interface ScanReport {
  dir: string
  source: SkillSource
  found: number
}

export async function listUserSkills(): Promise<{ skills: Skill[]; reports: ScanReport[] }> {
  const dir = userSkillsDir()
  const skills = await listFromDir(dir, 'global', undefined)
  return { skills, reports: [{ dir, source: 'global', found: skills.length }] }
}

export async function listProjectSkills(
  projectId: string,
): Promise<{ skills: Skill[]; reports: ScanReport[] }> {
  const project = await loadProject(projectId)
  if (!project) return { skills: [], reports: [] }
  const dir = join(project.path, AWOG_DIR_NAME, SKILLS_DIR_NAME)
  const skills = await listFromDir(dir, 'project', projectId)
  return { skills, reports: [{ dir, source: 'project', found: skills.length }] }
}

export async function listSkills(
  projectIds: string[] = [],
): Promise<{ skills: Skill[]; reports: ScanReport[] }> {
  const user = await listUserSkills()
  const projectResults = await Promise.all(projectIds.map((id) => listProjectSkills(id)))
  const projectSkills = projectResults.flatMap((r) => r.skills)
  const projectReports = projectResults.flatMap((r) => r.reports)
  const skills = [...user.skills, ...projectSkills].sort((a, b) => a.name.localeCompare(b.name))
  return { skills, reports: [...user.reports, ...projectReports] }
}

// First-match lookup across tiers, given a skill id (no source). Used by the
// workflow node runner where a node references its task-template skill by slug.
// Search order: global → project (per-project iterated in input order). Returns
// null if no matching skill found.
export async function loadSkillByIdAnyTier(
  id: string,
  projectIds: string[] = [],
): Promise<Skill | null> {
  // Reuse listSkills (already handles missing dirs gracefully). For small N
  // (typical user has <100 skills) the find-after-flatten cost is negligible
  // vs adding 5 separate readFile probes.
  const { skills } = await listSkills(projectIds)
  return skills.find((s) => s.id === id) ?? null
}

export async function loadSkill(
  id: string,
  source: SkillSource,
  projectId?: string,
): Promise<Skill | null> {
  const dir = await resolveSkillsDir(source, projectId)
  const file = join(skillFolder(dir, id), 'SKILL.md')
  try {
    const raw = await readFile(file, 'utf8')
    return buildSkill(id, raw, source, projectId)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

export async function saveSkill(skill: Skill): Promise<void> {
  const dir = await resolveSkillsDir(skill.source, skill.projectId)
  const folder = skillFolder(dir, skill.id)
  await mkdir(folder, { recursive: true, mode: 0o700 })
  const data: Record<string, string | string[] | undefined> = {
    name: skill.name,
    description: skill.description,
    icon: skill.icon,
    globs: skill.globs,
    alwaysAllow: skill.alwaysAllow,
    requiredSources: skill.requiredSources,
  }
  const file = join(folder, 'SKILL.md')
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, serializeFrontmatter(data, skill.body), 'utf8')
  await rename(tmp, file)
}

export async function deleteSkill(
  id: string,
  source: SkillSource,
  projectId?: string,
): Promise<void> {
  const dir = await resolveSkillsDir(source, projectId)
  try {
    await rm(skillFolder(dir, id), { recursive: true, force: true })
  } catch (err) {
    if (isMissing(err)) return
    throw err
  }
}

export async function renameSkill(
  fromId: string,
  toId: string,
  source: SkillSource,
  projectId?: string,
): Promise<void> {
  if (fromId === toId) return
  const dir = await resolveSkillsDir(source, projectId)
  const fromDir = skillFolder(dir, fromId)
  const toDir = skillFolder(dir, toId)
  try {
    await stat(toDir)
    throw new Error(`Skill already exists in ${source}: ${toId}`)
  } catch (err) {
    if (!isMissing(err)) throw err
  }
  await rename(fromDir, toDir)
}
