// Config Import Assistant (ADR 0035 / config-import-assistant). Scans legacy
// locations for config not yet in an AWOG store and copies the selected items in
// (non-destructive — sources are left untouched). This module is the single
// owner of legacy Claude Code / Craft layout knowledge.
//
// Since ADR 0070 the `.claude` tree IS the store for agents/skills/commands, so
// it is no longer an import source for those kinds — only Craft's `.agents` is.
// `.claude` remains a source for the two kinds AWOG still owns itself:
//   - rules  ← CLAUDE.md + .claude/rules/*.md
//   - hooks  ← .claude/settings.json hooks array
//
// Security (ADR 0035 D-5/D-10):
//   - copy, never move (sources preserved)
//   - imported hooks land untrusted (no .trust.json entry) — trust gate intact
//   - secret values are never copied; `${secret:KEY}` refs stay as text

import { cp, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { loadProject } from '../projects/store.js'
import { parseFrontmatter } from '../skills/frontmatter.js'
import { listAgents } from '../agents/store.js'
import { listSkills } from '../skills/store.js'
import { listCommands } from '../commands/store.js'
import { listRules, saveRule } from '../rules/store.js'
import { listHooks, saveHook } from '../hooks/store.js'
import { parseClaudeHooks } from '../hooks/claude-import.js'
import type { ConfigKind, ImportCandidate, ImportResult, Rule } from '../types/shared.js'

type Scope = 'global' | 'project'

export interface ImportRef {
  kind: ConfigKind
  id: string
  targetScope: Scope
  projectId?: string
}

interface SourceItem {
  kind: ConfigKind
  id: string
  name: string
  fromLabel: string
  targetScope: Scope
  projectId?: string
  doImport: () => Promise<void>
}

interface ScanContext {
  scope: Scope
  projectId?: string
  projectPath?: string
  // Legacy roots that hold agents/<id>, skills/<id>. Craft's `.agents` only —
  // `.claude` is the live store now (ADR 0070), scanning it would self-import.
  legacyRoots: { dir: string; label: string }[]
  // The `.claude` root — still scanned for rules/ + settings.json hooks.
  claudeRoot: string
  // CLAUDE.md location for this scope.
  claudeMd: string
}

function str(value: string | string[] | undefined, fallback = ''): string {
  if (Array.isArray(value)) return value.join(', ')
  return value ?? fallback
}

// Target `.awog/<kind>s` dir for a scope.
function awogDir(kind: ConfigKind, scope: Scope, projectPath?: string): string {
  const sub = `${kind}s`
  return scope === 'global' ? join(awogHome(), sub) : join(projectPath as string, '.awog', sub)
}

async function dirExists(file: string): Promise<boolean> {
  try {
    const s = await stat(file)
    return s.isDirectory()
  } catch {
    return false
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

async function readName(file: string, fallback: string): Promise<string> {
  try {
    const raw = await readFile(file, 'utf8')
    const { data } = parseFrontmatter(raw)
    return typeof data.name === 'string' && data.name ? data.name : fallback
  } catch {
    return fallback
  }
}

// ─── Per-kind scanners (build SourceItem closures) ───────────────────────────

async function collectAgents(ctx: ScanContext): Promise<SourceItem[]> {
  const out: SourceItem[] = []
  const seen = new Set<string>()
  for (const root of ctx.legacyRoots) {
    const baseDir = join(root.dir, 'agents')
    let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[]
    try {
      // eslint-disable-next-line no-await-in-loop
      entries = await readdir(baseDir, { withFileTypes: true })
    } catch {
      continue
    }
    // Folder layout <id>/AGENT.md wins over single-file <id>.md.
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const folder = join(baseDir, e.name)
      const file = join(folder, 'AGENT.md')
      // eslint-disable-next-line no-await-in-loop
      if (!(await fileExists(file))) continue
      const id = e.name
      if (seen.has(id)) continue
      seen.add(id)
      // eslint-disable-next-line no-await-in-loop
      const name = await readName(file, id)
      const targetDir = awogDir('agent', ctx.scope, ctx.projectPath)
      out.push({
        kind: 'agent',
        id,
        name,
        fromLabel: `${root.label}/agents`,
        targetScope: ctx.scope,
        ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
        doImport: async () => {
          await mkdir(targetDir, { recursive: true, mode: 0o700 })
          await cp(folder, join(targetDir, sanitizeChild(id)), { recursive: true, force: true })
        },
      })
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.md')) continue
      const id = e.name.slice(0, -3)
      if (!id || seen.has(id)) continue
      seen.add(id)
      const file = join(baseDir, e.name)
      // eslint-disable-next-line no-await-in-loop
      const name = await readName(file, id)
      const targetDir = awogDir('agent', ctx.scope, ctx.projectPath)
      out.push({
        kind: 'agent',
        id,
        name,
        fromLabel: `${root.label}/agents`,
        targetScope: ctx.scope,
        ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
        doImport: async () => {
          await mkdir(targetDir, { recursive: true, mode: 0o700 })
          await cp(file, join(targetDir, `${sanitizeChild(id)}.md`), { force: true })
        },
      })
    }
  }
  return out
}

async function collectSkills(ctx: ScanContext): Promise<SourceItem[]> {
  const out: SourceItem[] = []
  const seen = new Set<string>()
  for (const root of ctx.legacyRoots) {
    const baseDir = join(root.dir, 'skills')
    let entries: string[]
    try {
      // eslint-disable-next-line no-await-in-loop
      entries = await readdir(baseDir)
    } catch {
      continue
    }
    for (const id of entries) {
      if (id.startsWith('.') || seen.has(id)) continue
      const folder = join(baseDir, id)
      const file = join(folder, 'SKILL.md')
      // eslint-disable-next-line no-await-in-loop
      if (!(await dirExists(folder)) || !(await fileExists(file))) continue
      seen.add(id)
      // eslint-disable-next-line no-await-in-loop
      const name = await readName(file, id)
      const targetDir = awogDir('skill', ctx.scope, ctx.projectPath)
      out.push({
        kind: 'skill',
        id,
        name,
        fromLabel: `${root.label}/skills`,
        targetScope: ctx.scope,
        ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
        doImport: async () => {
          await mkdir(targetDir, { recursive: true, mode: 0o700 })
          await cp(folder, join(targetDir, sanitizeChild(id)), { recursive: true, force: true })
        },
      })
    }
  }
  return out
}

async function collectRules(ctx: ScanContext): Promise<SourceItem[]> {
  const out: SourceItem[] = []
  const pushRule = (id: string, name: string, file: string, fromLabel: string): void => {
    out.push({
      kind: 'rule',
      id,
      name,
      fromLabel,
      targetScope: ctx.scope,
      ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
      doImport: async () => {
        const raw = await readFile(file, 'utf8')
        const { data, body } = parseFrontmatter(raw)
        const text = body.trim() || raw.trim()
        const rule: Rule = {
          id,
          name: str(data.name, name),
          description: str(data.description),
          body: text,
          enabled: true,
          source: ctx.scope,
          ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
        }
        await saveRule(rule)
      },
    })
  }

  // CLAUDE.md (the canonical instruction file) → a single rule.
  if (await fileExists(ctx.claudeMd)) {
    pushRule('claude-md', 'CLAUDE.md', ctx.claudeMd, ctx.scope === 'global' ? '~/.claude' : 'CLAUDE.md')
  }
  // {scope}/.claude/rules/*.md
  const rulesDir = join(ctx.claudeRoot, 'rules')
  let entries: string[] = []
  try {
    entries = await readdir(rulesDir)
  } catch {
    entries = []
  }
  for (const name of entries) {
    if (!name.endsWith('.md')) continue
    const id = name.slice(0, -3)
    if (!id) continue
    // eslint-disable-next-line no-await-in-loop
    const display = await readName(join(rulesDir, name), id)
    pushRule(id, display, join(rulesDir, name), '.claude/rules')
  }
  return out
}

async function collectHooks(ctx: ScanContext): Promise<SourceItem[]> {
  const out: SourceItem[] = []
  const settingsFiles =
    ctx.scope === 'global'
      ? [join(ctx.claudeRoot, 'settings.json')]
      : [join(ctx.claudeRoot, 'settings.json'), join(ctx.claudeRoot, 'settings.local.json')]
  for (const settingsPath of settingsFiles) {
    // eslint-disable-next-line no-await-in-loop
    const drafts = await parseClaudeHooks(settingsPath)
    for (const draft of drafts) {
      out.push({
        kind: 'hook',
        id: draft.id,
        name: draft.name,
        fromLabel: settingsPath.endsWith('.local.json')
          ? '.claude/settings.local.json'
          : '.claude/settings.json',
        targetScope: ctx.scope,
        ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
        doImport: async () => {
          // Imported hooks land UNTRUSTED (no .trust.json entry) — gate intact.
          await saveHook({
            ...draft,
            matcher: draft.matcher ?? {},
            source: ctx.scope,
            ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
          })
        },
      })
    }
  }
  return out
}

// ─── Orchestration ───────────────────────────────────────────────────────────

// Scope is exclusive: a projectId scans ONLY that project's legacy dirs; without
// one we scan ONLY global. Global config is imported from its own entry
// (Settings → Workspace) so a project banner never surfaces unrelated global
// items.
async function buildContexts(projectId?: string): Promise<ScanContext[]> {
  if (projectId) {
    const project = await loadProject(projectId)
    if (!project) return []
    return [
      {
        scope: 'project',
        projectId,
        projectPath: project.path,
        legacyRoots: [{ dir: join(project.path, '.agents'), label: '.agents' }],
        claudeRoot: join(project.path, '.claude'),
        claudeMd: join(project.path, 'CLAUDE.md'),
      },
    ]
  }
  const home = homedir()
  return [
    {
      scope: 'global',
      legacyRoots: [{ dir: join(home, '.agents'), label: '.agents' }],
      claudeRoot: join(home, '.claude'),
      claudeMd: join(home, '.claude', 'CLAUDE.md'),
    },
  ]
}

async function collectSources(projectId?: string): Promise<SourceItem[]> {
  const contexts = await buildContexts(projectId)
  const all: SourceItem[] = []
  for (const ctx of contexts) {
    // eslint-disable-next-line no-await-in-loop
    // No collectCommands: its only source was `.claude/commands`, which IS the
    // command store since ADR 0070 — there is nothing left to import from.
    const perKind = await Promise.all([
      collectAgents(ctx),
      collectSkills(ctx),
      collectRules(ctx),
      collectHooks(ctx),
    ])
    all.push(...perKind.flat())
  }
  return all
}

function refKey(kind: ConfigKind, scope: Scope, projectId: string | undefined, id: string): string {
  return `${kind}:${scope}:${projectId ?? ''}:${id}`
}

// Set of `${kind}:${scope}:${projectId}:${id}` already present in `.awog`.
async function existingKeys(projectId?: string): Promise<Set<string>> {
  const pids = projectId ? [projectId] : []
  const keys = new Set<string>()
  try {
    const [a, s, r, c, h] = await Promise.all([
      listAgents(pids),
      listSkills(pids),
      listRules(pids),
      listCommands(pids),
      listHooks(pids),
    ])
    a.agents.forEach((x) => keys.add(refKey('agent', x.source, x.projectId, x.id)))
    s.skills.forEach((x) => keys.add(refKey('skill', x.source, x.projectId, x.id)))
    r.rules.forEach((x) => keys.add(refKey('rule', x.source ?? 'global', x.projectId, x.id)))
    c.commands.forEach((x) => keys.add(refKey('command', x.source ?? 'global', x.projectId, x.id)))
    h.hooks.forEach((x) => keys.add(refKey('hook', x.source ?? 'global', x.projectId, x.id)))
  } catch (err) {
    log.warn('migration: failed to gather existing entities', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
  return keys
}

// Public: list importable candidates (deduped) for the UI.
export async function scanImportCandidates(projectId?: string): Promise<ImportCandidate[]> {
  const [sources, existing] = await Promise.all([collectSources(projectId), existingKeys(projectId)])
  const seen = new Set<string>()
  const out: ImportCandidate[] = []
  for (const s of sources) {
    const key = refKey(s.kind, s.targetScope, s.projectId, s.id)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      kind: s.kind,
      id: s.id,
      name: s.name,
      fromLabel: s.fromLabel,
      targetScope: s.targetScope,
      ...(s.projectId ? { projectId: s.projectId } : {}),
      alreadyExists: existing.has(key),
    })
  }
  return out
}

// Public: import the requested items (copy into `.awog`). Returns a report.
export async function importCandidates(refs: ImportRef[], projectId?: string): Promise<ImportResult> {
  const sources = await collectSources(projectId)
  const byKey = new Map<string, SourceItem>()
  for (const s of sources) {
    const key = refKey(s.kind, s.targetScope, s.projectId, s.id)
    if (!byKey.has(key)) byKey.set(key, s)
  }
  const imported: ImportResult['imported'] = []
  const skipped: ImportResult['skipped'] = []
  for (const ref of refs) {
    const key = refKey(ref.kind, ref.targetScope, ref.projectId, ref.id)
    const src = byKey.get(key)
    if (!src) {
      skipped.push({ kind: ref.kind, id: ref.id, reason: 'source not found' })
      continue
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await src.doImport()
      imported.push({ kind: ref.kind, id: ref.id })
    } catch (err) {
      log.warn('migration: import failed', {
        ref,
        err: err instanceof Error ? err.message : String(err),
      })
      skipped.push({
        kind: ref.kind,
        id: ref.id,
        reason: err instanceof Error ? err.message : 'import failed',
      })
    }
  }
  return { imported, skipped }
}
