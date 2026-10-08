// `awog project ls|use|add` — pick which project `chat`/`task` run against.
// `use` persists the default to ~/.awog/cli.json so the CLI remembers it
// between invocations (no engine call needed for the default itself).

import { randomBytes } from 'node:crypto'
import type { Engine } from '../transport.js'
import { loadCliState, saveCliState } from '../cli-state.js'
import { note, sgr, table } from '../tty.js'

export interface Project {
  id: string
  name?: string
  path?: string
  description?: string
  gitRemote?: string
  llmDefaults?: { provider?: string; modelId?: string }
}

export async function listProjects(engine: Engine): Promise<Project[]> {
  const res = await engine.rpc<{ projects?: Project[] } | Project[]>('projects.list')
  return Array.isArray(res) ? res : (res.projects ?? [])
}

/** id | name | path → project. Throws with the known ids when nothing matches. */
export async function findProject(engine: Engine, ref: string): Promise<Project> {
  const projects = await listProjects(engine)
  const hit = projects.find((p) => p.id === ref || p.name === ref || p.path === ref)
  if (!hit) {
    throw new Error(
      `project not found: ${ref} (known: ${projects.map((p) => p.id).join(', ') || 'none'})`,
    )
  }
  return hit
}

/**
 * Resolution order used by chat/task:
 *   --project flag → AWOG_PROJECT env → ~/.awog/cli.json default → cwd match.
 * Returns null when nothing resolves (chat stays project-less).
 */
export async function resolveDefaultProject(
  engine: Engine,
  explicit: string | undefined,
): Promise<Project | null> {
  const ref = explicit ?? process.env.AWOG_PROJECT ?? (await loadCliState()).projectId
  if (ref) return findProject(engine, ref)
  const projects = await listProjects(engine)
  return projects.find((p) => p.path === process.cwd()) ?? null
}

export async function cmdProjectLs(engine: Engine, json: boolean): Promise<void> {
  const projects = await listProjects(engine)
  if (json) {
    process.stdout.write(`${JSON.stringify(projects, null, 2)}\n`)
    return
  }
  const def = (await loadCliState()).projectId
  const rows = projects.map((p) => [
    p.id === def ? sgr.ok('●') : '',
    p.id,
    p.name ?? '',
    p.path ?? '',
    p.llmDefaults?.modelId ? sgr.dim(p.llmDefaults.modelId) : '',
  ])
  process.stdout.write(`${table(['', 'ID', 'NAME', 'PATH', 'MODEL'], rows, [1, 22, 16, 'flex', 18])}\n`)
  note(`${sgr.accent('·')} ${sgr.dim(`${projects.length} project(s) — ● is the CLI default`)}`)
}

export async function cmdProjectUse(engine: Engine, ref: string): Promise<void> {
  const p = await findProject(engine, ref)
  await saveCliState({ projectId: p.id })
  note(`${sgr.accent('·')} default project → ${sgr.bold(p.id)}${p.path ? sgr.dim(` (${p.path})`) : ''}`)
}

export async function cmdProjectAdd(
  engine: Engine,
  pathArg: string,
  nameFlag: string | undefined,
): Promise<void> {
  const name = nameFlag ?? pathArg.split('/').filter(Boolean).pop() ?? pathArg
  const id = `proj-${randomBytes(5).toString('hex')}`
  await engine.rpc('projects.upsert', {
    mode: 'create',
    project: {
      id,
      name,
      path: pathArg,
      description: '',
      gitRemote: '',
      gitBranch: '',
      language: '',
      createdAt: new Date().toISOString(),
    },
  })
  note(`${sgr.accent('·')} project ${sgr.bold(id)} registered — ${sgr.dim(pathArg)}`)
}
