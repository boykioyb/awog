// The `RunWorkflow` tool for the Pi runtime (ADR 0055). Lets the model, mid-chat,
// spawn a background Task (an instance of a Workflow) from the current session.
// Unlike the `Task` subagent tool (which runs a delegate to completion inside the
// turn), this kicks off a durable, multi-phase Task on the Task Execution Engine
// and returns immediately with the new task id — the workflow runs in the
// background, streaming task.* events the UI already subscribes to.
//
// Design:
//   - Spawned task's source = { type:'session', sessionId } so the UI links it
//     back to the session (the session's Tasks panel + a "From session" badge).
//   - Gated like a mutating tool (runtime/permission.ts): in ask/accept-edits mode
//     it prompts the user for approval; in execute mode it runs unprompted; in
//     plan mode the tool is NOT registered at all (run-stream), so it can't fire.
//   - Depth = 1: never added to a subagent's toolset (run-stream only), so a
//     subagent can't recursively spawn tasks. A per-turn breadth cap backs that up.

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { randomBytes } from 'node:crypto'
import { loadWorkflowByIdAnyTier } from '../../workflows/store.js'
import { createTask } from '../../tasks/store.js'
import { startTask } from '../../tasks/engine.js'
import type { TaskPhase, Workflow } from '../../types/shared.js'
import { log } from '../../util/logger.js'

// Stable, model-facing tool name. Added to the permission gate's mutating set
// (runtime/permission.ts) so it prompts for approval outside execute mode.
export const RUN_WORKFLOW_TOOL_NAME = 'RunWorkflow'

// Per-turn breadth cap: a single turn can't fan out into an unbounded number of
// background tasks (depth is already 1 — the tool is never in a subagent toolset).
const MAX_TASKS_PER_TURN = 5

const Params = Type.Object({
  workflowId: Type.String({
    description: 'The id of the workflow to run (see the list of available workflows above).',
  }),
  title: Type.Optional(
    Type.String({ description: 'Optional title for the task. Defaults to the workflow name.' }),
  ),
  prompt: Type.Optional(
    Type.String({
      description:
        'Optional description / instructions stored on the task (shown to the user and available to the workflow agents).',
    }),
  ),
})

interface RunWorkflowDetails {
  workflowId: string
  taskId?: string
}

export interface RunWorkflowToolDeps {
  // The session this turn belongs to — stamped as the spawned task's origin.
  sessionId: string
  // The session's project (required to create a task). The tool is only built
  // when this is present (run-stream), so it's never empty here.
  projectId: string
  // Workflows in scope (global + project) for the description menu + validation.
  workflows: Workflow[]
}

function describeTool(workflows: Workflow[]): string {
  const intro =
    'Start a background Task by running one of this workspace\'s saved Workflows. ' +
    'The Task runs its multi-phase pipeline autonomously on the Task engine and is linked back to this session; ' +
    'this tool returns immediately with the new task id (it does NOT wait for the task to finish). ' +
    'Use it when the user asks to kick off durable, multi-step work (review, migration, release) as a tracked task rather than doing it inline.'
  if (workflows.length === 0) {
    return `${intro}\n\n(No workflows are configured in this workspace, so there is nothing to run — tell the user to create a workflow first.)`
  }
  const menu = workflows
    .map((w) => `- ${w.id}: ${w.name}${w.description ? ` — ${w.description.split('\n')[0]}` : ''}`)
    .join('\n')
  return `${intro}\n\nAvailable workflowId values:\n${menu}`
}

export function createRunWorkflowTool(
  deps: RunWorkflowToolDeps,
): AgentTool<typeof Params, RunWorkflowDetails> {
  let spawned = 0

  return {
    name: RUN_WORKFLOW_TOOL_NAME,
    label: RUN_WORKFLOW_TOOL_NAME,
    description: describeTool(deps.workflows),
    parameters: Params,
    // Sequential so a multi-call turn spawns tasks one at a time (each persists a
    // JSONL event log); the per-turn cap bounds the total.
    executionMode: 'sequential',
    async execute(_toolCallId, params) {
      const details: RunWorkflowDetails = { workflowId: params.workflowId }

      if (spawned >= MAX_TASKS_PER_TURN) {
        return {
          content: [
            {
              type: 'text',
              text: `Task limit reached (${MAX_TASKS_PER_TURN} per turn). Don't start more workflows this turn.`,
            },
          ],
          details,
        }
      }

      const workflow = await loadWorkflowByIdAnyTier(params.workflowId, [deps.projectId])
      if (!workflow) {
        const ids = deps.workflows.map((w) => w.id).join(', ') || '(none)'
        return {
          content: [
            {
              type: 'text',
              text: `Unknown workflowId "${params.workflowId}". Available workflows: ${ids}.`,
            },
          ],
          details,
        }
      }

      spawned += 1
      const id = `tsk-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
      const phases: Record<string, TaskPhase> = {}
      for (const node of workflow.nodes) {
        phases[node.id] = { nodeId: node.id, status: 'pending', skillName: node.skillId, runs: [] }
      }

      try {
        await createTask({
          id,
          title: params.title?.trim() || workflow.name,
          projectId: deps.projectId,
          source: { type: 'session', sessionId: deps.sessionId },
          description: params.prompt?.trim() ?? '',
          workflowId: workflow.id,
          status: 'queued',
          currentNodeId: null,
          waitingApproval: null,
          waitingConnection: null,
          createdAt: new Date().toISOString(),
          workflowSnapshot: workflow,
          commitCoAuthor: true,
          phases,
        })
        startTask(id)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.warn('RunWorkflow: failed to start task', { workflowId: workflow.id, err: message })
        return {
          content: [{ type: 'text', text: `Failed to start the workflow: ${message}` }],
          details,
        }
      }

      details.taskId = id
      log.info('RunWorkflow: task spawned', {
        taskId: id,
        workflowId: workflow.id,
        sessionId: deps.sessionId,
      })
      return {
        content: [
          {
            type: 'text',
            text: `Started task "${params.title?.trim() || workflow.name}" (id: ${id}, status: queued) running workflow "${workflow.name}". It runs in the background — the user can track it on the Tasks page or this session's Tasks panel. Don't wait for it; continue the conversation.`,
          },
        ],
        details,
      }
    },
  }
}
