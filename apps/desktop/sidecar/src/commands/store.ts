// Slash command persistence. Single editable home `.awog`, two tiers (ADR 0035).
// Each command is a Markdown file (YAML frontmatter + body) like Claude Code's
// `.claude/commands/<name>.md`:
//   global  → ~/.awog/commands/<id>.md           (editable)
//   project → {project.path}/.awog/commands/<id>.md (editable)
//
// Frontmatter keys: name, description, argument-hint, allowed-tools, model,
// enabled. The body is the prompt template expanded on send. source/projectId
// are location-derived (NOT written into the file). Subdirectory namespacing is
// supported the Claude Code way: `frontend/component.md` → id `frontend:component`.
// `.claude/commands` are an import source only (see migration/).

import { mkdir, readdir, readFile, writeFile, chmod, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'
import { parseFrontmatter, serializeFrontmatter } from '../skills/frontmatter.js'
import type { Command, CommandScanReport, CommandSource } from '../types/shared.js'

const COMMANDS_DIR_NAME = sanitizeChild('commands')

function globalCommandsDir(): string {
  return join(awogHome(), COMMANDS_DIR_NAME)
}
function projectCommandsDir(projectPath: string): string {
  return join(projectPath, '.awog', COMMANDS_DIR_NAME)
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

// id ↔ relative path. Subdir namespacing uses ':' (Claude Code convention).
function idToRelPath(id: string): string {
  return `${id.split(':').map(sanitizeChild).join('/')}.md`
}
function relPathToId(relPath: string): string {
  const noExt = relPath.endsWith('.md') ? relPath.slice(0, -3) : relPath
  return noExt.split('/').join(':')
}

function parse(raw: string, id: string, source: CommandSource, projectId: string | undefined): Command {
  const { data, body } = parseFrontmatter(raw)
  return {
    id,
    name: asString(data.name, id),
    description: asString(data.description),
    body: body.trim(),
    ...(data['argument-hint'] ? { argumentHint: asString(data['argument-hint']) } : {}),
    ...(data['allowed-tools'] ? { allowedTools: asString(data['allowed-tools']) } : {}),
    ...(data.model ? { model: asString(data.model) } : {}),
    // enabled defaults true; only an explicit "false" disables.
    enabled: asString(data.enabled, 'true').toLowerCase() !== 'false',
    source,
    ...(projectId ? { projectId } : {}),
  }
}

// Recursively collect `.md` files under `dir`, returning their id (relative path
// with ':' namespacing) + absolute file path. Depth-bounded to keep the scan
// cheap; deeper nesting than this is not a Claude Code convention. Exported for
// the migration scanner (reads `.claude/commands`).
export async function walkMd(dir: string, prefix = '', depth = 0): Promise<{ id: string; file: string }[]> {
  if (depth > 3) return []
  let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('commands: walkMd failed', { dir, err: err instanceof Error ? err.message : String(err) })
    }
    return []
  }
  const out: { id: string; file: string }[] = []
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      out.push(...(await walkMd(join(dir, entry.name), rel, depth + 1)))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push({ id: relPathToId(rel), file: join(dir, entry.name) })
    }
  }
  return out
}

async function listFromDir(
  dir: string,
  source: CommandSource,
  projectId: string | undefined,
): Promise<Command[]> {
  const files = await walkMd(dir)
  const commands: Command[] = []
  for (const { id, file } of files) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const raw = await readFile(file, 'utf8')
      commands.push(parse(raw, id, source, projectId))
    } catch (err) {
      log.warn('commands: failed to read file', { file, err: err instanceof Error ? err.message : String(err) })
    }
  }
  return commands
}

// Full listing for the UI: tags location + reports each scanned dir.
export async function listCommands(
  projectIds: string[] = [],
): Promise<{ commands: Command[]; reports: CommandScanReport[] }> {
  const reports: CommandScanReport[] = []
  const global = await listFromDir(globalCommandsDir(), 'global', undefined)
  reports.push({ dir: globalCommandsDir(), source: 'global', found: global.length })

  const projectResults = await Promise.all(
    projectIds.map(async (id) => {
      const project = await loadProject(id)
      if (!project) return []
      const nativeDir = projectCommandsDir(project.path)
      const native = await listFromDir(nativeDir, 'project', id)
      reports.push({ dir: nativeDir, source: 'project', found: native.length, projectId: id })
      return native
    }),
  )

  const commands = [...global, ...projectResults.flat()]
  commands.sort((a, b) => a.name.localeCompare(b.name))
  return { commands, reports }
}

function resolveDir(source: CommandSource, projectPath: string | undefined): string {
  if (source === 'global') return globalCommandsDir()
  // source === 'project'
  if (!projectPath) throw new RpcError(-32602, 'Project command requires a projectId')
  return projectCommandsDir(projectPath)
}

async function projectPathFor(projectId: string | undefined): Promise<string | undefined> {
  if (!projectId) return undefined
  const project = await loadProject(projectId)
  if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
  return project.path
}

export async function loadCommand(
  id: string,
  source: CommandSource = 'global',
  projectId?: string,
): Promise<Command | null> {
  const dir = resolveDir(source, await projectPathFor(projectId))
  const file = join(dir, idToRelPath(id))
  try {
    const raw = await readFile(file, 'utf8')
    return parse(raw, id, source, projectId)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

// Serialize a command to its on-disk form (full frontmatter incl. name + enabled).
function serialize(command: Command): string {
  const fm: Record<string, string | undefined> = {
    name: command.name,
    description: command.description,
    'argument-hint': command.argumentHint,
    'allowed-tools': command.allowedTools,
    model: command.model,
    enabled: command.enabled ? 'true' : 'false',
  }
  return serializeFrontmatter(fm, command.body ?? '')
}

export async function saveCommand(command: Command): Promise<void> {
  const source = command.source ?? 'global'
  const dir = resolveDir(source, await projectPathFor(command.projectId))
  const file = join(dir, idToRelPath(command.id))
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const content = serialize(command)
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, content, 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

export async function deleteCommand(
  id: string,
  source: CommandSource = 'global',
  projectId?: string,
): Promise<void> {
  const dir = resolveDir(source, await projectPathFor(projectId))
  try {
    await unlink(join(dir, idToRelPath(id)))
  } catch (err) {
    if (!isMissing(err)) throw err
  }
}
