// Workflow (DAG template) persistence. Two tiers (ADR 0024 follow-up), mirroring
// Skills/Agents:
//   global  → ~/.awog/workflows/<id>.json            (shared across projects)
//   project → {project.path}/.awog/workflows/<id>.json (travels with the repo)
//
// source + projectId are derived from the on-disk location (like Skills), NOT
// stored in the JSON — a project workflow committed to a repo must not hardcode
// the machine-specific AWOG project id. Update = atomic .tmp + rename. Delete =
// unlink. validateWorkflow runs on every save (unique nodes, valid edges, DAG).

import { mkdir, readdir, readFile, writeFile, chmod, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'
import type { Workflow, WorkflowEdge, WorkflowNode, WorkflowSource } from '../types/shared.js'

const WORKFLOWS_DIR_NAME = sanitizeChild('workflows')

function globalWorkflowsDir(): string {
  return join(awogHome(), WORKFLOWS_DIR_NAME)
}

function projectWorkflowsDir(projectPath: string): string {
  return join(projectPath, '.awog', WORKFLOWS_DIR_NAME)
}

async function resolveWorkflowsDir(
  source: WorkflowSource,
  projectId: string | undefined,
): Promise<string> {
  if (source === 'global') return globalWorkflowsDir()
  if (!projectId) throw new RpcError(-32602, 'Project workflow requires a projectId')
  const project = await loadProject(projectId)
  if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
  return projectWorkflowsDir(project.path)
}

function workflowFile(dir: string, id: string): string {
  return join(dir, `${sanitizeChild(id)}.json`)
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

function parse(
  raw: string,
  file: string,
  source: WorkflowSource,
  projectId: string | undefined,
): Workflow | null {
  try {
    const obj = JSON.parse(raw) as unknown
    if (!obj || typeof obj !== 'object') return null
    const w = obj as Record<string, unknown>
    if (typeof w.id !== 'string' || typeof w.name !== 'string') return null
    if (!Array.isArray(w.nodes) || !Array.isArray(w.edges)) return null
    const wf = obj as Workflow
    // Tag location (overrides any stale source/projectId in the file).
    wf.source = source
    if (projectId) wf.projectId = projectId
    else delete wf.projectId
    return wf
  } catch (err) {
    log.warn('workflows: failed to parse', {
      file,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// Kahn's algorithm — true if the node/edge set is a DAG (no cycle).
function isAcyclic(nodes: WorkflowNode[], edges: WorkflowEdge[]): boolean {
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  nodes.forEach((n) => {
    inDegree.set(n.id, 0)
    adj.set(n.id, [])
  })
  edges.forEach((e) => {
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1)
    adj.get(e.from)?.push(e.to)
  })
  const queue: string[] = []
  inDegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id)
  })
  let visited = 0
  while (queue.length) {
    const id = queue.shift() as string
    visited += 1
    ;(adj.get(id) ?? []).forEach((next) => {
      const deg = (inDegree.get(next) ?? 0) - 1
      inDegree.set(next, deg)
      if (deg === 0) queue.push(next)
    })
  }
  return visited === nodes.length
}

// True if `ancestorId` can reach `nodeId` by following edges forward — i.e.
// nodeId is a transitive DOWNSTREAM of ancestorId (so ancestorId is upstream).
function isAncestor(
  nodeId: string,
  ancestorId: string,
  edges: WorkflowEdge[],
): boolean {
  const adj = new Map<string, string[]>()
  edges.forEach((e) => {
    const list = adj.get(e.from) ?? []
    list.push(e.to)
    adj.set(e.from, list)
  })
  const seen = new Set<string>()
  const queue = [...(adj.get(ancestorId) ?? [])]
  while (queue.length) {
    const id = queue.shift() as string
    if (id === nodeId) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const next of adj.get(id) ?? []) queue.push(next)
  }
  return false
}

export function validateWorkflow(wf: Workflow): void {
  const ids = new Set<string>()
  wf.nodes.forEach((n) => {
    if (ids.has(n.id)) throw new RpcError(-32602, `Duplicate node id: ${n.id}`)
    ids.add(n.id)
  })
  wf.edges.forEach((e) => {
    if (!ids.has(e.from)) throw new RpcError(-32602, `Edge references missing node: ${e.from}`)
    if (!ids.has(e.to)) throw new RpcError(-32602, `Edge references missing node: ${e.to}`)
  })
  if (!isAcyclic(wf.nodes, wf.edges)) {
    throw new RpcError(-32602, 'Workflow has a cycle — DAG required')
  }
  // Gate loop-back targets (ADR 0056): onFailTarget must be a transitive
  // ANCESTOR of the gate so re-running it re-flows the path back down to the
  // gate — and the DAG stays acyclic (the loop is a directive, not an edge).
  wf.nodes.forEach((n) => {
    if (!n.gate) return
    const { onFailTarget, maxIterations } = n.gate
    if (!ids.has(onFailTarget)) {
      throw new RpcError(-32602, `Gate onFailTarget references missing node: ${onFailTarget}`)
    }
    if (onFailTarget === n.id) {
      throw new RpcError(-32602, `Gate onFailTarget cannot be the gate itself: ${n.id}`)
    }
    if (!isAncestor(n.id, onFailTarget, wf.edges)) {
      throw new RpcError(
        -32602,
        `Gate onFailTarget "${onFailTarget}" must be an upstream ancestor of gate "${n.id}"`,
      )
    }
    if (!Number.isFinite(maxIterations) || maxIterations < 1) {
      throw new RpcError(-32602, `Gate maxIterations must be >= 1 (node ${n.id})`)
    }
  })
}

async function listFromDir(
  dir: string,
  source: WorkflowSource,
  projectId: string | undefined,
): Promise<Workflow[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('workflows: listFromDir failed', {
        dir,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    return []
  }
  const workflows: Workflow[] = []
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    const file = join(dir, name)
    try {
      // eslint-disable-next-line no-await-in-loop
      const raw = await readFile(file, 'utf8')
      const wf = parse(raw, file, source, projectId)
      if (wf) workflows.push(wf)
    } catch (err) {
      log.warn('workflows: failed to read file', {
        file,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return workflows
}

async function listProjectWorkflows(projectId: string): Promise<Workflow[]> {
  const project = await loadProject(projectId)
  if (!project) return []
  return listFromDir(projectWorkflowsDir(project.path), 'project', projectId)
}

export async function listWorkflows(projectIds: string[] = []): Promise<Workflow[]> {
  const global = await listFromDir(globalWorkflowsDir(), 'global', undefined)
  const projectResults = await Promise.all(projectIds.map((id) => listProjectWorkflows(id)))
  const workflows = [...global, ...projectResults.flat()]
  workflows.sort((a, b) => a.name.localeCompare(b.name))
  return workflows
}

export async function loadWorkflow(
  id: string,
  source: WorkflowSource = 'global',
  projectId?: string,
): Promise<Workflow | null> {
  const dir = await resolveWorkflowsDir(source, projectId)
  const file = workflowFile(dir, id)
  try {
    const raw = await readFile(file, 'utf8')
    return parse(raw, file, source, projectId)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

// First-match lookup by id across global + the given project tiers. Used by
// tasks.create to snapshot the workflow without the UI plumbing the exact tuple.
export async function loadWorkflowByIdAnyTier(
  id: string,
  projectIds: string[] = [],
): Promise<Workflow | null> {
  const all = await listWorkflows(projectIds)
  return all.find((w) => w.id === id) ?? null
}

export async function saveWorkflow(workflow: Workflow): Promise<void> {
  validateWorkflow(workflow)
  const source = workflow.source ?? 'global'
  const dir = await resolveWorkflowsDir(source, workflow.projectId)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = workflowFile(dir, workflow.id)
  // Persist the template only — source/projectId are location-derived.
  const persisted = {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    nodes: workflow.nodes,
    edges: workflow.edges,
  }
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(persisted, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

export async function deleteWorkflow(
  id: string,
  source: WorkflowSource = 'global',
  projectId?: string,
): Promise<void> {
  const dir = await resolveWorkflowsDir(source, projectId)
  const file = workflowFile(dir, id)
  try {
    await unlink(file)
  } catch (err) {
    if (isMissing(err)) return
    throw err
  }
}
