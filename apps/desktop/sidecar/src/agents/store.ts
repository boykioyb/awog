// Agent persistence. Each agent is a single `<id>.md` file with YAML
// frontmatter + markdown body, format-compatible with Claude Code SDK
// subagents. Five tiers (mirror Skills):
//
//   global         → ~/.awog/agents/<id>.md           (AWOG-native)
//   user-claude    → ~/.claude/agents/<id>.md         (Claude Code SDK)
//   user-agents    → ~/.agents/agents/<id>.md         (Craft Agents)
//   project-claude → {project.path}/.claude/agents/<id>.md
//   project-agents → {project.path}/.agents/agents/<id>.md
//
// systemPrompt = markdown body. Frontmatter required: name, description.
// Frontmatter optional: model, role.
// (`context` field from old Context Providers feature is silent-dropped on
//  read and never written back — see ADR 0016.)

import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rename,
  unlink,
  rm,
  stat,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { parseFrontmatter, serializeFrontmatter } from '../skills/frontmatter.js'
import { loadProject } from '../projects/store.js'
import type { Agent, AgentSource } from '../types/shared.js'

const AGENTS_DIR_NAME = sanitizeChild('agents')

function userAgentsDir(source: 'global' | 'user-claude' | 'user-agents'): string {
  if (source === 'global') return join(awogHome(), AGENTS_DIR_NAME)
  if (source === 'user-claude') return join(homedir(), '.claude', 'agents')
  return join(homedir(), '.agents', 'agents')
}

function projectAgentsDir(projectPath: string, source: AgentSource): string {
  if (source === 'project-claude') return join(projectPath, '.claude', 'agents')
  if (source === 'project-agents') return join(projectPath, '.agents', 'agents')
  throw new Error(`Not a project-scoped source: ${source}`)
}

async function resolveAgentsDir(
  source: AgentSource,
  projectId: string | undefined,
): Promise<string> {
  if (source === 'global' || source === 'user-claude' || source === 'user-agents') {
    return userAgentsDir(source)
  }
  if (!projectId) {
    throw new Error(`Source ${source} requires a projectId`)
  }
  const project = await loadProject(projectId)
  if (!project) {
    throw new Error(`Project not found: ${projectId}`)
  }
  return projectAgentsDir(project.path, source)
}

function agentFile(dir: string, id: string): string {
  return join(dir, `${sanitizeChild(id)}.md`)
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

function toStringArray(value: unknown): string[] {
  if (value === undefined) return []
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
  }
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function buildAgent(
  id: string,
  raw: string,
  source: AgentSource,
  projectId: string | undefined,
): Agent | null {
  const { data, body } = parseFrontmatter(raw)
  const name = typeof data.name === 'string' ? data.name : ''
  const description = typeof data.description === 'string' ? data.description : ''
  if (!name) {
    // Claude Code subagents require `name`; we follow the same rule.
    return null
  }
  const agent: Agent = {
    id,
    source,
    name,
    description,
    // ADR 0026 — LLM provider. Missing/unknown frontmatter → 'anthropic'
    // (backward-compat with agents authored before multi-provider).
    provider:
      data.provider === 'openai' || data.provider === 'google' ? data.provider : 'anthropic',
    model: typeof data.model === 'string' ? data.model : '',
    systemPrompt: body,
    role: typeof data.role === 'string' ? data.role : '',
  }
  if (projectId) agent.projectId = projectId
  // Optional per-agent account override (ADR 0026). Resolved at runtime; falls
  // back to the provider's active account if the id no longer exists.
  if (typeof data.accountId === 'string' && data.accountId.length > 0) {
    agent.accountId = data.accountId
  }
  // Per-agent MCP whitelist — ADR 0016. Empty/undefined → inherit session.
  const mcpServerIds = toStringArray(data.mcpServerIds)
  if (mcpServerIds.length > 0) agent.mcpServerIds = mcpServerIds
  // `tools` is a Claude Code subagent standard field. Accept both flow form
  // (`tools: [Read, Grep]`) and comma-separated string (`tools: "Read, Grep"`)
  // which the docs show. Only attach when non-empty so the SDK toolset stays
  // unrestricted by default.
  const rawTools = data.tools
  let tools: string[] = []
  if (Array.isArray(rawTools)) {
    tools = rawTools.filter((v): v is string => typeof v === 'string' && v.length > 0)
  } else if (typeof rawTools === 'string' && rawTools.length > 0) {
    tools = rawTools
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }
  if (tools.length > 0) agent.tools = tools
  return agent
}

// Read both layouts the community uses:
//   1. <id>.md           — single-file (Anthropic Claude Code docs default)
//   2. <id>/AGENT.md     — folder with AGENT.md inside (mirrors Skills SKILL.md;
//                          lets the agent ship colocated notes/memory files)
// Folder layout wins if both exist for the same slug.
async function listFromDir(
  dir: string,
  source: AgentSource,
  projectId: string | undefined,
): Promise<Agent[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('agents: listFromDir failed', {
        dir,
        source,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    return []
  }
  log.info('agents: scanning', { dir, source, entries: entries.length })
  const byId = new Map<string, Agent>()
  const seenFromFolder = new Set<string>()

  // First pass: folder layout `<id>/AGENT.md`.
  for (const name of entries) {
    if (name.endsWith('.md')) continue
    if (name.startsWith('.')) continue // skip dotfiles like .DS_Store
    const folder = join(dir, name)
    const file = join(folder, 'AGENT.md')
    try {
      // eslint-disable-next-line no-await-in-loop
      const s = await stat(folder)
      if (!s.isDirectory()) continue
      // eslint-disable-next-line no-await-in-loop
      const raw = await readFile(file, 'utf8')
      const agent = buildAgent(name, raw, source, projectId)
      if (agent) {
        byId.set(name, agent)
        seenFromFolder.add(name)
      } else {
        log.warn('agents: AGENT.md missing required frontmatter `name`', { file })
      }
    } catch (err) {
      if (!isMissing(err)) {
        log.warn('agents: failed to read AGENT.md', {
          file,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  // Second pass: single-file layout `<id>.md`. Skip ids already claimed by a
  // folder so the more-detailed folder version wins on conflict.
  for (const name of entries) {
    if (!name.endsWith('.md')) continue
    const id = name.slice(0, -3)
    if (!id) continue
    if (seenFromFolder.has(id)) continue
    const file = join(dir, name)
    try {
      // eslint-disable-next-line no-await-in-loop
      const raw = await readFile(file, 'utf8')
      const agent = buildAgent(id, raw, source, projectId)
      if (agent) byId.set(id, agent)
      else log.warn('agents: missing required frontmatter `name`', { file })
    } catch (err) {
      if (!isMissing(err)) {
        log.warn('agents: failed to read', {
          file,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  const agents = [...byId.values()]
  log.info('agents: scan result', { dir, source, found: agents.length })
  return agents
}

export interface AgentScanReport {
  dir: string
  source: AgentSource
  found: number
}

export async function listUserAgents(): Promise<{
  agents: Agent[]
  reports: AgentScanReport[]
}> {
  const tiers: { source: AgentSource; dir: string }[] = [
    { source: 'global', dir: userAgentsDir('global') },
    { source: 'user-claude', dir: userAgentsDir('user-claude') },
    { source: 'user-agents', dir: userAgentsDir('user-agents') },
  ]
  const results = await Promise.all(
    tiers.map(({ source, dir }) => listFromDir(dir, source, undefined)),
  )
  const agents = results.flat()
  const reports: AgentScanReport[] = tiers.map((tier, i) => ({
    dir: tier.dir,
    source: tier.source,
    found: results[i]?.length ?? 0,
  }))
  return { agents, reports }
}

export async function listProjectAgents(
  projectId: string,
): Promise<{ agents: Agent[]; reports: AgentScanReport[] }> {
  const project = await loadProject(projectId)
  if (!project) return { agents: [], reports: [] }
  const tiers: { source: AgentSource; dir: string }[] = [
    { source: 'project-claude', dir: projectAgentsDir(project.path, 'project-claude') },
    { source: 'project-agents', dir: projectAgentsDir(project.path, 'project-agents') },
  ]
  const results = await Promise.all(
    tiers.map(({ source, dir }) => listFromDir(dir, source, projectId)),
  )
  const agents = results.flat()
  const reports: AgentScanReport[] = tiers.map((tier, i) => ({
    dir: tier.dir,
    source: tier.source,
    found: results[i]?.length ?? 0,
  }))
  return { agents, reports }
}

export async function listAgents(
  projectIds: string[] = [],
): Promise<{ agents: Agent[]; reports: AgentScanReport[] }> {
  const user = await listUserAgents()
  const projectResults = await Promise.all(projectIds.map((id) => listProjectAgents(id)))
  const projectAgents = projectResults.flatMap((r) => r.agents)
  const projectReports = projectResults.flatMap((r) => r.reports)
  const agents = [...user.agents, ...projectAgents].sort((a, b) => a.name.localeCompare(b.name))
  return { agents, reports: [...user.reports, ...projectReports] }
}

export async function loadAgent(
  id: string,
  source: AgentSource,
  projectId?: string,
): Promise<Agent | null> {
  const dir = await resolveAgentsDir(source, projectId)
  // Prefer the folder layout (matches Skills + community convention used in
  // some repos), fall back to single-file when not present.
  const folderFile = join(dir, sanitizeChild(id), 'AGENT.md')
  try {
    const raw = await readFile(folderFile, 'utf8')
    return buildAgent(id, raw, source, projectId)
  } catch (err) {
    if (!isMissing(err)) throw err
  }
  const singleFile = agentFile(dir, id)
  try {
    const raw = await readFile(singleFile, 'utf8')
    return buildAgent(id, raw, source, projectId)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

// If a folder layout already exists for this id, return its path. Otherwise
// undefined → caller should default to single-file `<id>.md`. Probing both is
// important so an existing `<id>/AGENT.md` doesn't get shadowed by a sibling
// `<id>.md` write — the scanner's "folder wins" rule would then hide the new
// save from the user.
async function existingFolderPath(dir: string, id: string): Promise<string | undefined> {
  const folder = join(dir, sanitizeChild(id))
  try {
    const s = await stat(folder)
    if (s.isDirectory()) return folder
  } catch (err) {
    if (!isMissing(err)) throw err
  }
  return undefined
}

export async function saveAgent(agent: Agent): Promise<void> {
  const dir = await resolveAgentsDir(agent.source, agent.projectId)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  // Frontmatter order — name+description first (Claude Code compat), then
  // optional model, then AWOG extension fields. The serializer drops keys with
  // empty-string / empty-array values, so vanilla Claude Code subagents stay
  // unaffected by AWOG extras.
  const data: Record<string, string | string[] | undefined> = {
    name: agent.name,
    description: agent.description,
    // Only write `provider` when non-default so vanilla / Anthropic agents keep
    // a clean frontmatter (and stay backward-compatible). ADR 0026.
    provider: agent.provider === 'anthropic' ? undefined : agent.provider,
    accountId: agent.accountId,
    model: agent.model,
    role: agent.role,
    tools: agent.tools,
    mcpServerIds: agent.mcpServerIds,
  }
  // Preserve the user's chosen layout: if `<id>/AGENT.md` already exists, write
  // back to it (preserves colocated sibling files like agent-memory/). New
  // agents AWOG creates default to single-file `<id>.md` to match Anthropic's
  // documented Claude Code subagent format.
  const folder = await existingFolderPath(dir, agent.id)
  const file = folder ? join(folder, 'AGENT.md') : agentFile(dir, agent.id)
  if (folder) {
    await mkdir(folder, { recursive: true, mode: 0o700 })
  }
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, serializeFrontmatter(data, agent.systemPrompt), 'utf8')
  await rename(tmp, file)
}

export async function deleteAgent(
  id: string,
  source: AgentSource,
  projectId?: string,
): Promise<void> {
  const dir = await resolveAgentsDir(source, projectId)
  // Folder layout: rm -r the whole folder (drops any colocated notes/memory —
  // acceptable because the user explicitly asked to delete the agent).
  const folder = await existingFolderPath(dir, id)
  if (folder) {
    await rm(folder, { recursive: true, force: true })
    return
  }
  const file = agentFile(dir, id)
  try {
    await unlink(file)
  } catch (err) {
    if (isMissing(err)) return
    throw err
  }
}

export async function renameAgent(
  fromId: string,
  toId: string,
  source: AgentSource,
  projectId?: string,
): Promise<void> {
  if (fromId === toId) return
  const dir = await resolveAgentsDir(source, projectId)

  // Folder layout takes priority — rename the whole folder so sibling files
  // travel with the agent.
  const fromFolder = await existingFolderPath(dir, fromId)
  if (fromFolder) {
    const toFolder = join(dir, sanitizeChild(toId))
    try {
      await stat(toFolder)
      throw new Error(`Agent already exists in ${source}: ${toId}`)
    } catch (err) {
      if (!isMissing(err)) throw err
    }
    await rename(fromFolder, toFolder)
    return
  }

  // Single-file rename.
  const fromFile = agentFile(dir, fromId)
  const toFile = agentFile(dir, toId)
  try {
    await stat(toFile)
    throw new Error(`Agent already exists in ${source}: ${toId}`)
  } catch (err) {
    if (!isMissing(err)) throw err
  }
  await rename(fromFile, toFile)
}
