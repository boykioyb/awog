// Rule persistence (ADR 0033). Two tiers, mirroring Skills/Hooks, but each rule
// is a Markdown file (YAML frontmatter + body) like SKILL.md:
//   global  → ~/.awog/rules/<id>.md
//   project → {project.path}/.awog/rules/<id>.md
//
// Frontmatter keys: name, description, enabled. The body is the instruction text
// injected into the agent system prompt (rules/inject.ts). source/projectId are
// location-derived (NOT written into the file — a project rule committed to a
// repo must not hardcode the machine-specific project id).

import { mkdir, readdir, readFile, writeFile, chmod, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'
import { parseFrontmatter, serializeFrontmatter } from '../skills/frontmatter.js'
import type { Rule, RuleScanReport, RuleSource } from '../types/shared.js'

const RULES_DIR_NAME = sanitizeChild('rules')

function globalRulesDir(): string {
  return join(awogHome(), RULES_DIR_NAME)
}

function projectRulesDir(projectPath: string): string {
  return join(projectPath, '.awog', RULES_DIR_NAME)
}

async function resolveRulesDir(source: RuleSource, projectId: string | undefined): Promise<string> {
  if (source === 'global') return globalRulesDir()
  if (!projectId) throw new RpcError(-32602, 'Project rule requires a projectId')
  const project = await loadProject(projectId)
  if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
  return projectRulesDir(project.path)
}

function ruleFile(dir: string, id: string): string {
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

// Frontmatter `globs` may be a YAML list (string[]) or a comma-separated string.
// Normalize both to a trimmed, non-empty string[].
function asStringArray(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return raw.map((s) => s.trim()).filter((s) => s.length > 0)
}

function parse(raw: string, id: string, source: RuleSource, projectId: string | undefined): Rule {
  const { data, body } = parseFrontmatter(raw)
  const globs = asStringArray(data.globs)
  return {
    id,
    name: asString(data.name, id),
    description: asString(data.description),
    body: body.trim(),
    // enabled defaults true; only an explicit "false" disables.
    enabled: asString(data.enabled, 'true').toLowerCase() !== 'false',
    ...(globs.length > 0 ? { globs } : {}),
    source,
    ...(projectId ? { projectId } : {}),
  }
}

function idFromFile(name: string): string {
  return name.endsWith('.md') ? name.slice(0, -3) : name
}

async function listFromDir(
  dir: string,
  source: RuleSource,
  projectId: string | undefined,
): Promise<Rule[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('rules: listFromDir failed', { dir, err: err instanceof Error ? err.message : String(err) })
    }
    return []
  }
  const rules: Rule[] = []
  for (const name of entries) {
    if (!name.endsWith('.md')) continue
    const file = join(dir, name)
    try {
      // eslint-disable-next-line no-await-in-loop
      const raw = await readFile(file, 'utf8')
      rules.push(parse(raw, idFromFile(name), source, projectId))
    } catch (err) {
      log.warn('rules: failed to read file', { file, err: err instanceof Error ? err.message : String(err) })
    }
  }
  return rules
}

// Full listing for the UI: tags location + reports each scanned dir.
export async function listRules(
  projectIds: string[] = [],
): Promise<{ rules: Rule[]; reports: RuleScanReport[] }> {
  const reports: RuleScanReport[] = []
  const global = await listFromDir(globalRulesDir(), 'global', undefined)
  reports.push({ dir: globalRulesDir(), source: 'global', found: global.length })

  const projectResults = await Promise.all(
    projectIds.map(async (id) => {
      const project = await loadProject(id)
      if (!project) return []
      const dir = projectRulesDir(project.path)
      const native = await listFromDir(dir, 'project', id)
      reports.push({ dir, source: 'project', found: native.length, projectId: id })
      return native
    }),
  )

  const rules = [...global, ...projectResults.flat()]
  rules.sort((a, b) => a.name.localeCompare(b.name))
  return { rules, reports }
}

// Enabled rules for injection (enabled only): global + the turn's project.
export async function listEnabledRulesForInject(projectId: string | undefined): Promise<Rule[]> {
  const global = (await listFromDir(globalRulesDir(), 'global', undefined)).filter((r) => r.enabled)
  if (!projectId) return global
  const project = await loadProject(projectId)
  if (!project) return global
  const projNative = (await listFromDir(projectRulesDir(project.path), 'project', projectId)).filter(
    (r) => r.enabled,
  )
  return [...global, ...projNative]
}

export async function loadRule(
  id: string,
  source: RuleSource = 'global',
  projectId?: string,
): Promise<Rule | null> {
  const dir = await resolveRulesDir(source, projectId)
  try {
    const raw = await readFile(ruleFile(dir, id), 'utf8')
    return parse(raw, id, source, projectId)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

export async function saveRule(rule: Rule): Promise<void> {
  const source = rule.source ?? 'global'
  const dir = await resolveRulesDir(source, rule.projectId)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const content = serializeFrontmatter(
    {
      name: rule.name,
      description: rule.description,
      enabled: rule.enabled ? 'true' : 'false',
      // ADR 0050: persist as a YAML list when set; omitted entirely when empty.
      ...(rule.globs && rule.globs.length > 0 ? { globs: rule.globs } : {}),
    },
    rule.body ?? '',
  )
  const file = ruleFile(dir, rule.id)
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, content, 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

export async function deleteRule(
  id: string,
  source: RuleSource = 'global',
  projectId?: string,
): Promise<void> {
  const dir = await resolveRulesDir(source, projectId)
  try {
    await unlink(ruleFile(dir, id))
  } catch (err) {
    if (!isMissing(err)) throw err
  }
}
