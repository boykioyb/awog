// ExitPlanMode AgentTool for the Pi runtime — the plan-mode counterpart to
// Claude Code's built-in tool (lost in the ADR 0029 migration; restored here).
//
// Flow: in plan mode the model researches read-only, then calls ExitPlanMode
// with its plan. The plan content reaches the UI as a `kind:'plan'` step that
// event-adapter.ts emits from this call's INPUT (so the plan card renders
// before approval). The tool itself just ends the turn (terminate) — the user
// reviews + approves in the UI, which flips the session to execute mode and
// kicks off the run. So the tool's own return is never surfaced beyond closing
// the planning turn.
//
// Security: read-only. It mutates nothing; the permission gate (permission.ts)
// keeps Write/Edit/Bash blocked while in plan mode regardless of this call.

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'

const ExitPlanParams = Type.Object({
  plan: Type.String({
    description:
      'The implementation plan to present to the user for approval, as concise markdown: a short rationale (optional) followed by a numbered or bulleted list of concrete steps.',
  }),
})

interface ExitPlanDetails {
  plan: string
}

export function createExitPlanModeTool(): AgentTool<typeof ExitPlanParams, ExitPlanDetails> {
  return {
    name: 'ExitPlanMode',
    label: 'Plan',
    description:
      'Use ONLY when you are in plan mode and have finished researching the task: present your implementation plan to the user for approval. Do not call this for read-only questions or before you have a concrete plan. After calling it, stop — the user reviews and approves before any file is changed.',
    parameters: ExitPlanParams,
    async execute(_id, params): Promise<AgentToolResult<ExitPlanDetails>> {
      return {
        content: [
          {
            type: 'text',
            text: 'Plan presented to the user. Awaiting approval before making any changes.',
          },
        ],
        details: { plan: params.plan },
        // End the turn: the user reviews + approves in the UI before execution.
        terminate: true,
      }
    },
  }
}
