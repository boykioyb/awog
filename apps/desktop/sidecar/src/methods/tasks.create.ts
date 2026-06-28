import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { createTask } from '../tasks/store.js'
import { loadWorkflowByIdAnyTier } from '../workflows/store.js'
import { startTask } from '../tasks/engine.js'
import type { Task, TaskPhase, TaskSource } from '../types/shared.js'

// connectionId = mcpServerId the task uses to reach its source (ADR 0025
// simplified). Optional; never carries a token, only the id.
const TaskSourceSchema = z.union([
  z.object({
    type: z.literal('github'),
    repo: z.string(),
    issueNumber: z.number(),
    url: z.string(),
    connectionId: z.string().optional(),
  }),
  z.object({ type: z.literal('jira'), key: z.string(), connectionId: z.string().optional() }),
  z.object({ type: z.literal('manual') }),
  // Spawned from a chat session (ADR 0055). sessionId = the origin session's id.
  z.object({
    type: z.literal('session'),
    sessionId: z.string().min(1),
    messageId: z.string().optional(),
    connectionId: z.string().optional(),
  }),
])

const Params = z.object({
  id: z.string().min(1),
  title: z.string(),
  projectId: z.string().min(1),
  source: TaskSourceSchema,
  description: z.string(),
  workflowId: z.string().min(1),
  // Snapshot of the UI's `commitCoAuthor` Git setting. Omitted by legacy/older
  // callers → defaults to enabled (matches the UI default).
  commitCoAuthor: z.boolean().optional(),
  // Snapshot of the remaining auto-commit Git settings (settings live in the
  // renderer; the sidecar can't read them). Omitted by legacy callers → engine
  // defaults (per-phase on, workspace scope, default template).
  autoCommitPerPhase: z.boolean().optional(),
  autoCommitScope: z.enum(['workspace', 'artifacts-only']).optional(),
  autoCommitMessageTemplate: z.string().max(400).optional(),
})

register('tasks.create', async (raw) => {
  const params = Params.parse(raw)

  // Resolve the workflow across tiers (global + the task's project) so a
  // project-scoped workflow is found without plumbing the exact source tuple.
  const workflow = await loadWorkflowByIdAnyTier(params.workflowId, [params.projectId])
  if (!workflow) throw new RpcError(-32602, `Workflow not found: ${params.workflowId}`)

  // Seed one pending phase per workflow node. skillName denormalises the node's
  // skill slug for fast display (the UI's PhaseCard reads it).
  const phases: Record<string, TaskPhase> = {}
  for (const node of workflow.nodes) {
    phases[node.id] = {
      nodeId: node.id,
      status: 'pending',
      skillName: node.skillId,
      runs: [],
    }
  }

  const task: Task = {
    id: params.id,
    title: params.title,
    projectId: params.projectId,
    source: params.source as TaskSource,
    description: params.description,
    workflowId: params.workflowId,
    status: 'queued',
    currentNodeId: null,
    waitingApproval: null,
    waitingConnection: null,
    createdAt: new Date().toISOString(),
    // Snapshot the DAG so editing the workflow later never mutates this task.
    workflowSnapshot: workflow,
    // Snapshot the co-author preference so per-phase auto-commit is consistent
    // across restart/rerun (default enabled when the caller omits it).
    commitCoAuthor: params.commitCoAuthor ?? true,
    // Snapshot the rest of the auto-commit settings (omitted → engine defaults).
    autoCommitPerPhase: params.autoCommitPerPhase ?? true,
    autoCommitScope: params.autoCommitScope ?? 'workspace',
    ...(params.autoCommitMessageTemplate !== undefined
      ? { autoCommitMessageTemplate: params.autoCommitMessageTemplate }
      : {}),
    phases,
  }

  await createTask(task)
  // Kick off execution (fire-and-forget — the engine streams task.* events).
  startTask(task.id)

  return { task }
})
