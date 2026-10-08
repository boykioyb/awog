// `awog task run <workflow> --project <id> [--watch]` — create + follow a task
// run over the engine. Approval gates print to stderr; `tasks.approvePhase`
// resolves them when the user answers y.

import { randomBytes } from 'node:crypto'
import type { Engine } from '../transport.js'
import { askLine, isTTY, note, sgr } from '../tty.js'
import { resolveDefaultProject } from './project.js'

interface Workflow {
  id: string
  name?: string
}

interface Project {
  id: string
  name?: string
  path?: string
}

interface Task {
  id: string
  title?: string | undefined
  status?: string
}

export interface TaskRunOptions {
  workflow: string // id or exact name
  project?: string | undefined
  title?: string | undefined
  description?: string | undefined
  watch?: boolean
  approve?: boolean // auto-answer phase approvals with 'y'
  json?: boolean
}

async function resolveProject(engine: Engine, ref: string | undefined): Promise<string> {
  // flag → AWOG_PROJECT → ~/.awog/cli.json default → cwd match. Errors when
  // nothing resolves — a task needs a project to anchor the workflow list.
  const project = await resolveDefaultProject(engine, ref)
  if (!project) {
    throw new Error(
      'no --project and cwd is not a registered project — `awog project use <id>` or pass --project',
    )
  }
  return project.id
}

async function resolveWorkflow(
  engine: Engine,
  ref: string,
  projectId: string,
): Promise<Workflow> {
  const res = await engine.rpc<{ workflows?: Workflow[] } | Workflow[]>('workflows.list', {
    projectIds: [projectId],
  })
  const workflows = Array.isArray(res) ? res : (res.workflows ?? [])
  const hit = workflows.find((w) => w.id === ref || w.name === ref)
  if (!hit) {
    throw new Error(`workflow not found: ${ref} (known: ${workflows.map((w) => w.id).join(', ')})`)
  }
  return hit
}

export async function cmdTaskRun(engine: Engine, o: TaskRunOptions): Promise<void> {
  const projectId = await resolveProject(engine, o.project)
  const workflow = await resolveWorkflow(engine, o.workflow, projectId)
  const taskId = `task-${randomBytes(6).toString('hex')}`
  const title = o.title ?? `CLI: ${workflow.name ?? workflow.id}`

  const { promise: finished, resolve: resolveFinished } = Promise.withResolvers<{
    status: string
    detail?: string
  }>()

  engine.onEvent(async (evt) => {
    const p =
      evt.payload && typeof evt.payload === 'object'
        ? (evt.payload as Record<string, unknown>)
        : {}
    if (p.taskId !== taskId) return

    if (evt.type === 'task.run.output' && !o.json) {
      const delta = typeof p.delta === 'string' ? p.delta : ''
      process.stdout.write(delta)
    } else if (evt.type === 'task.phase.status') {
      note(`  ${sgr.dim('·')} phase ${sgr.bold(String(p.nodeId))} → ${sgr.dim(String(p.status))}`)
      if (p.status === 'waiting_approval') {
        const yes = o.approve || (isTTY() && (await askLine(`    approve phase ${String(p.nodeId)}? [y/N] `)).trim().toLowerCase() === 'y')
        await engine
          .rpc('tasks.approvePhase', { taskId, nodeId: String(p.nodeId) })
          .then(() => note(`    approved`))
          .catch((e: Error) => note(`    approve failed: ${e.message}`))
        if (!yes) note('    (skipped approve — task will wait)')
        else {
          /* answered above */
        }
      }
    } else if (evt.type === 'task.status') {
      const status = String(p.status)
      note(
        `${sgr.accent('·')} task ${
          status === 'completed' ? sgr.ok(status)
          : status === 'failed' ? sgr.err(status)
          : sgr.dim(status)
        }`,
      )
      if (['completed', 'failed', 'canceled'].includes(status)) {
        resolveFinished({ status, ...(typeof p.detail === 'string' ? { detail: p.detail } : {}) })
      }
    } else if (o.json) {
      process.stdout.write(`${JSON.stringify({ t: evt.type, ...p })}\n`)
    }
  })

  const { task } = await engine.rpc<{ task: Task }>('tasks.create', {
    id: taskId,
    title,
    projectId,
    source: { type: 'manual' },
    description: o.description ?? '',
    workflowId: workflow.id,
  })
  note(
    `${sgr.accent('·')} task ${sgr.bold(task.id)} → workflow ${sgr.dim(
      `${workflow.name ?? workflow.id} on project ${projectId}`,
    )}`,
  )

  if (!o.watch) {
    note(`· running — watch with \`awog task watch ${task.id}\` or follow the app`)
    return
  }
  const done = await finished
  process.exitCode = done.status === 'completed' ? 0 : 1
}
