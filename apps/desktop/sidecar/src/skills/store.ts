// Skill persistence. Each skill is a folder containing SKILL.md (YAML
// frontmatter + markdown body). Five tiers:
//
//   global         → ~/.awog/skills/<id>/SKILL.md           (AWOG-native)
//   user-claude    → ~/.claude/skills/<id>/SKILL.md         (Claude Code SDK)
//   user-agents    → ~/.agents/skills/<id>/SKILL.md         (Craft Agents)
//   project-claude → {project.path}/.claude/skills/<id>/SKILL.md
//   project-agents → {project.path}/.agents/skills/<id>/SKILL.md
//
// Same on-disk shape as Claude Code SDK / craft-agents-oss, so a skill written
// here is reusable outside AWOG and vice versa.

import { mkdir, readdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js'
import { loadProject } from '../projects/store.js'
import type { Skill, SkillSource } from '../types/shared.js'

const SKILLS_DIR_NAME = sanitizeChild('skills')

function userSkillsDir(source: 'global' | 'user-claude' | 'user-agents'): string {
  if (source === 'global') return join(awogHome(), SKILLS_DIR_NAME)
  if (source === 'user-claude') return join(homedir(), '.claude', 'skills')
  return join(homedir(), '.agents', 'skills')
}

function projectSkillsDir(projectPath: string, source: SkillSource): string {
  if (source === 'project-claude') return join(projectPath, '.claude', 'skills')
  if (source === 'project-agents') return join(projectPath, '.agents', 'skills')
  throw new Error(`Not a project-scoped source: ${source}`)
}

async function resolveSkillsDir(
  source: SkillSource,
  projectId: string | undefined,
): Promise<string> {
  if (source === 'global' || source === 'user-claude' || source === 'user-agents') {
    return userSkillsDir(source)
  }
  if (!projectId) {
    throw new Error(`Source ${source} requires a projectId`)
  }
  const project = await loadProject(projectId)
  if (!project) {
    throw new Error(`Project not found: ${projectId}`)
  }
  return projectSkillsDir(project.path, source)
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
    if (isMissing(err)) return []
    throw err
  }
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
    } catch (err) {
      if (!isMissing(err)) {
        log.warn('skills: failed to read', {
          file,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  return skills
}

export async function listUserSkills(): Promise<Skill[]> {
  // All three user-level tiers are auto-scanned. Missing dirs return [] —
  // perfectly fine for users who do not have ~/.claude/skills or ~/.agents/skills.
  const [awog, claude, agents] = await Promise.all([
    listFromDir(userSkillsDir('global'), 'global', undefined),
    listFromDir(userSkillsDir('user-claude'), 'user-claude', undefined),
    listFromDir(userSkillsDir('user-agents'), 'user-agents', undefined),
  ])
  return [...awog, ...claude, ...agents]
}

export async function listProjectSkills(projectId: string): Promise<Skill[]> {
  const project = await loadProject(projectId)
  if (!project) return []
  const [fromClaude, fromAgents] = await Promise.all([
    listFromDir(
      projectSkillsDir(project.path, 'project-claude'),
      'project-claude',
      projectId,
    ),
    listFromDir(
      projectSkillsDir(project.path, 'project-agents'),
      'project-agents',
      projectId,
    ),
  ])
  return [...fromClaude, ...fromAgents]
}

export async function listSkills(projectIds: string[] = []): Promise<Skill[]> {
  const user = await listUserSkills()
  const projectLists = await Promise.all(projectIds.map((id) => listProjectSkills(id)))
  const project = projectLists.flat()
  return [...user, ...project].sort((a, b) => a.name.localeCompare(b.name))
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
