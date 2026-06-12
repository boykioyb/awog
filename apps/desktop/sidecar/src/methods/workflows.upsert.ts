import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { saveWorkflow } from '../workflows/store.js'
import type { Workflow } from '../types/shared.js'

const AgentSourceSchema = z.enum(['global', 'project'])

const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  agentId: z.string(),
  agentSource: AgentSourceSchema.optional(),
  agentProjectId: z.string().optional(),
  skillId: z.string(),
  x: z.number(),
  y: z.number(),
  outputs: z.array(z.string()),
  approval: z.boolean(),
})

const WorkflowEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
})

const WorkflowSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
  source: z.enum(['global', 'project']).optional(),
  projectId: z.string().optional(),
})

const Params = z.object({
  workflow: WorkflowSchema,
  mode: z.enum(['create', 'update']).optional(),
})

// exactOptionalPropertyTypes: rebuild nodes so undefined optional fields are not
// assigned at all (zod .optional() yields T | undefined).
function toNode(parsed: z.infer<typeof WorkflowNodeSchema>): Workflow['nodes'][number] {
  const base: Workflow['nodes'][number] = {
    id: parsed.id,
    agentId: parsed.agentId,
    skillId: parsed.skillId,
    x: parsed.x,
    y: parsed.y,
    outputs: parsed.outputs,
    approval: parsed.approval,
  }
  if (parsed.agentSource !== undefined) base.agentSource = parsed.agentSource
  if (parsed.agentProjectId !== undefined) base.agentProjectId = parsed.agentProjectId
  return base
}

register('workflows.upsert', async (raw) => {
  const params = Params.parse(raw)
  const workflow: Workflow = {
    id: params.workflow.id,
    name: params.workflow.name,
    description: params.workflow.description,
    nodes: params.workflow.nodes.map(toNode),
    edges: params.workflow.edges.map((e) => ({ from: e.from, to: e.to })),
  }
  if (params.workflow.source !== undefined) workflow.source = params.workflow.source
  if (params.workflow.projectId !== undefined) workflow.projectId = params.workflow.projectId
  // saveWorkflow runs validateWorkflow + writes to the right tier (global vs
  // {project}/.awog/workflows) based on source/projectId.
  await saveWorkflow(workflow)
  return { workflow }
})
