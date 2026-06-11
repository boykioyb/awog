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
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
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

// Imported Claude Code locations (read-only, ADR 0033 D-4 amended).
function userClaudeMd(): string {
  return join(homedir(), '.claude', 'CLAUDE.md')
}
function projectClaudeMd(projectPath: string): string {
  return join(projectPath, 'CLAUDE.md')
}
function projectClaudeRulesDir(projectPath: string): string {
  return join(projectPath, '.claude', 'rules')
}

// Only AWOG-native tiers can be written; claude-* are imported read-only.
function assertEditable(source: RuleSource): void {
  if (source !== 'global' && source !== 'project') {
    throw new RpcError(-32602, `Rule source "${source}" is imported (read-only)`)
  }
}

async function resolveRulesDir(source: RuleSource, projectId: string | undefined): Promise<string> {
  assertEditable(source)
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

function parse(raw: string, id: string, source: RuleSource, projectId: string | undefined): Rule {
  const { data, body } = parseFrontmatter(raw)
  return {
    id,
    name: asString(data.name, id),
    description: asString(data.description),
    body: body.trim(),
    // enabled defaults true; only an explicit "false" disables.
    enabled: asString(data.enabled, 'true').toLowerCase() !== 'false',
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

// ─── Imported (read-only) Claude Code sources ────────────────────────────────

// Read one Claude Code file as a read-only Rule. CLAUDE.md usually has no
// frontmatter → the whole content is the body. Returns null if missing/empty.
async function readImportedRule(
  file: string,
  id: string,
  source: RuleSource,
  projectId: string | undefined,
  fallbackName: string,
): Promise<Rule | null> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('rules: failed to read imported file', { file, err: err instanceof Error ? err.message : String(err) })
    }
    return null
  }
  const { data, body } = parseFrontmatter(raw)
  const text = (body.trim() || raw.trim())
  if (!text) return null
  return {
    id,
    name: asString(data.name, fallbackName),
    description: asString(data.description),
    body: text,
    enabled: true,
    source,
    ...(projectId ? { projectId } : {}),
    readOnly: true,
  }
}

// Scan {project}/.claude/rules/*.md as imported rules.
async function scanClaudeRulesDir(dir: string, projectId: string): Promise<Rule[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('rules: scanClaudeRulesDir failed', { dir, err: err instanceof Error ? err.message : String(err) })
    }
    return []
  }
  const out: Rule[] = []
  for (const name of entries) {
    if (!name.endsWith('.md')) continue
    // eslint-disable-next-line no-await-in-loop
    const rule = await readImportedRule(join(dir, name), idFromFile(name), 'claude-rules', projectId, idFromFile(name))
    if (rule) out.push(rule)
  }
  return out
}

// All imported rules for a project: {project}/CLAUDE.md + {project}/.claude/rules.
async function importedProjectRules(projectPath: string, projectId: string): Promise<Rule[]> {
  const out: Rule[] = []
  const claudeMd = await readImportedRule(projectClaudeMd(projectPath), 'CLAUDE', 'claude-project', projectId, 'CLAUDE.md')
  if (claudeMd) out.push(claudeMd)
  out.push(...(await scanClaudeRulesDir(projectClaudeRulesDir(projectPath), projectId)))
  return out
}

// User-global imported rules: ~/.claude/CLAUDE.md.
async function importedUserRules(): Promise<Rule[]> {
  const claudeMd = await readImportedRule(userClaudeMd(), 'CLAUDE', 'claude-user', undefined, 'CLAUDE.md (user)')
  return claudeMd ? [claudeMd] : []
}

// Full listing for the UI: tags location + reports each scanned dir.
export async function listRules(
  projectIds: string[] = [],
): Promise<{ rules: Rule[]; reports: RuleScanReport[] }> {
  const reports: RuleScanReport[] = []
  const global = await listFromDir(globalRulesDir(), 'global', undefined)
  reports.push({ dir: globalRulesDir(), source: 'global', found: global.length })

  // Imported user-global Claude Code config (~/.claude/CLAUDE.md).
  const userImported = await importedUserRules()
  reports.push({ dir: userClaudeMd(), source: 'claude-user', found: userImported.length })

  const projectResults = await Promise.all(
    projectIds.map(async (id) => {
      const project = await loadProject(id)
      if (!project) return []
      const dir = projectRulesDir(project.path)
      const native = await listFromDir(dir, 'project', id)
      reports.push({ dir, source: 'project', found: native.length, projectId: id })
      // Imported: {project}/CLAUDE.md + {project}/.claude/rules/*.md.
      const imported = await importedProjectRules(project.path, id)
      reports.push({ dir: join(project.path, '.claude'), source: 'claude-rules', found: imported.length, projectId: id })
      return [...native, ...imported]
    }),
  )

  const rules = [...global, ...userImported, ...projectResults.flat()]
  rules.sort((a, b) => a.name.localeCompare(b.name))
  return { rules, reports }
}

// Enabled rules for injection: AWOG-native (enabled only) + imported Claude Code
// config (always enabled). Imported are read-only and prioritised by the caller.
export async function listEnabledRulesForInject(projectId: string | undefined): Promise<Rule[]> {
  const global = (await listFromDir(globalRulesDir(), 'global', undefined)).filter((r) => r.enabled)
  const userImported = await importedUserRules()
  if (!projectId) return [...global, ...userImported]
  const project = await loadProject(projectId)
  if (!project) return [...global, ...userImported]
  const projNative = (await listFromDir(projectRulesDir(project.path), 'project', projectId)).filter(
    (r) => r.enabled,
  )
  const projImported = await importedProjectRules(project.path, projectId)
  return [...global, ...userImported, ...projNative, ...projImported]
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

// Write an edited IMPORTED rule back to its Claude Code source file (ADR 0033
// D-4 amended — user opted into in-app edit of imported config). Writes the body
// verbatim (no AWOG frontmatter): CLAUDE.md / .claude/rules/<id>.md stay clean.
async function writeImportedRule(
  source: RuleSource,
  projectId: string | undefined,
  id: string,
  body: string,
): Promise<void> {
  let file: string
  if (source === 'claude-user') {
    file = join(homedir(), '.claude', 'CLAUDE.md')
  } else {
    if (!projectId) throw new RpcError(-32602, 'Imported project rule requires a projectId')
    const project = await loadProject(projectId)
    if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
    if (source === 'claude-project') file = join(project.path, 'CLAUDE.md')
    else if (source === 'claude-rules')
      file = join(project.path, '.claude', 'rules', `${sanitizeChild(id)}.md`)
    else throw new RpcError(-32602, `Source "${source}" is not an editable imported rule`)
  }
  await mkdir(dirname(file), { recursive: true })
  const out = body.endsWith('\n') ? body : `${body}\n`
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, out, 'utf8')
  await rename(tmp, file)
}

export async function saveRule(rule: Rule): Promise<void> {
  const source = rule.source ?? 'global'
  // Imported (claude-*) → write body back to the Claude Code source file.
  if (source !== 'global' && source !== 'project') {
    await writeImportedRule(source, rule.projectId, rule.id, rule.body ?? '')
    return
  }
  const dir = await resolveRulesDir(source, rule.projectId)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const content = serializeFrontmatter(
    {
      name: rule.name,
      description: rule.description,
      enabled: rule.enabled ? 'true' : 'false',
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
