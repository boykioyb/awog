// Translate a Pi `AgentEvent` stream into AWOG's StreamCallbacks (onChunk /
// onStep) and accumulate the aggregate RunStreamResult (ADR 0029).
//
// Mapping:
//   message_update + assistantMessageEvent.text_delta → cb.onChunk(delta)
//   tool_execution_start → cb.onStep(stepFromToolUse) [status running]
//   tool_execution_end   → cb.onStep(stepFromToolResult) [status done/error]
//   agent_end            → read last assistant message: text, usage, stopReason.
//
// Dedupe: a tool's start may be reported once; we still guard with a Set keyed
// by toolCallId so an accidental double-start doesn't emit two running rows.
// step-mapper upserts by step.id (== toolCallId), so the UI merges running→done.

import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import {
  stepFromPlan,
  stepFromThinking,
  stepFromTodos,
  stepFromToolResult,
  stepFromToolUse,
} from '../sessions/step-mapper.js'
import type { StreamCallbacks } from '../sessions/runner.js'
import type { SessionStep } from '../types/shared.js'

interface Accumulator {
  text: string
  modelUsed: string
  inputTokens: number
  outputTokens: number
  stopReason: string | null
}

function isAssistant(m: AgentMessage): m is AssistantMessage {
  return (m as { role?: unknown }).role === 'assistant'
}

function assistantText(m: AssistantMessage): string {
  return m.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('')
}

// Coerce a Pi tool argument bag (any) to the Record<string, unknown> shape
// step-mapper consumes. Non-object args → empty record.
function toInputRecord(args: unknown): Record<string, unknown> {
  return typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}
}

export interface EventAdapter {
  handle: (event: AgentEvent) => void
  result: () => Accumulator
}

export interface EventAdapterOptions {
  // When set, this adapter is draining a SUBAGENT run (Task tool, ADR 0030):
  //   - every emitted step is tagged with this parentId so the UI nests it under
  //     the Task step instead of rendering top-level.
  //   - assistant text deltas are NOT forwarded to cb.onChunk (the subagent's
  //     text is its returned result, not the parent's reply); they still
  //     accumulate so the Task tool can read the final text.
  parentId?: string
}

export function createEventAdapter(
  cb: StreamCallbacks,
  options: EventAdapterOptions = {},
): EventAdapter {
  const { parentId } = options
  // Stamp parentId on a step when draining a subagent run (no-op otherwise).
  const withParent = (step: SessionStep): SessionStep =>
    parentId ? { ...step, parentId } : step
  const acc: Accumulator = {
    text: '',
    modelUsed: '',
    inputTokens: 0,
    outputTokens: 0,
    stopReason: null,
  }
  const announcedTools = new Set<string>()
  // Remember each tool's name + input at start so the end event can re-derive
  // the step target / diff stats without re-parsing the result.
  const toolInputs = new Map<string, { name: string; input: Record<string, unknown> }>()
  // Accumulate extended-thinking text per content block (keyed by contentIndex)
  // so each delta upserts the same 'thinking' step in place.
  const thinkingBlocks = new Map<number, string>()

  const handle = (event: AgentEvent): void => {
    switch (event.type) {
      case 'message_update': {
        const inner = event.assistantMessageEvent
        if (inner.type === 'text_delta' && inner.delta.length > 0) {
          acc.text += inner.delta
          // Subagent text is the Task tool's result, not the parent reply — don't
          // pour it into the parent's streamed answer.
          if (!parentId) cb.onChunk(inner.delta)
        } else if (inner.type === 'thinking_delta' && inner.delta.length > 0 && cb.onStep) {
          // Extended-thinking → a 'thinking' step carrying the full reasoning so
          // far in `detail`, so the UI streams it live (status 'running'). Stable
          // id per content block keeps the upsert merging in place as it grows.
          const next = (thinkingBlocks.get(inner.contentIndex) ?? '') + inner.delta
          thinkingBlocks.set(inner.contentIndex, next)
          cb.onStep(withParent(stepFromThinking(`thinking-${inner.contentIndex}`, next)))
        } else if (inner.type === 'thinking_end' && cb.onStep) {
          // Reasoning block complete → mark it done (status 'done') so the UI can
          // auto-collapse. `inner.content` is authoritative; fall back to the
          // accumulated deltas if the provider omits it.
          const full = inner.content || thinkingBlocks.get(inner.contentIndex) || ''
          if (full) cb.onStep(withParent(stepFromThinking(`thinking-${inner.contentIndex}`, full, true)))
        }
        break
      }
      case 'tool_execution_start': {
        if (!cb.onStep) break
        if (announcedTools.has(event.toolCallId)) break
        announcedTools.add(event.toolCallId)
        const input = toInputRecord(event.args)
        toolInputs.set(event.toolCallId, { name: event.toolName, input })
        // ExitPlanMode → a 'plan' step (the plan card) instead of a generic
        // tool row. The plan markdown rides in the call input; the user
        // approves/rejects in the UI (decoupled from the permission gate).
        if (event.toolName === 'ExitPlanMode') {
          const plan = typeof input.plan === 'string' ? input.plan : ''
          cb.onStep(withParent(stepFromPlan(event.toolCallId, plan)))
          break
        }
        // TodoWrite → an inline checklist 'note' step (built from the call input,
        // like ExitPlanMode); its result event is ignored below. A STABLE id
        // (per turn, per parent) so successive TodoWrite calls upsert ONE
        // evolving checklist instead of stacking a new row per update.
        if (event.toolName === 'TodoWrite') {
          cb.onStep(withParent(stepFromTodos('todo-list', input.todos)))
          break
        }
        cb.onStep(withParent(stepFromToolUse({ id: event.toolCallId, name: event.toolName, input })))
        break
      }
      case 'tool_execution_end': {
        if (!cb.onStep) break
        // ExitPlanMode / TodoWrite already emitted their step on start; the
        // result is an internal ack — don't overwrite it with a generic tool row.
        if (event.toolName === 'ExitPlanMode' || event.toolName === 'TodoWrite') break
        const meta = toolInputs.get(event.toolCallId) ?? { name: event.toolName, input: {} }
        // event.result is the AgentToolResult { content, details, terminate }.
        // step-mapper's previewToolResult understands the content array shape.
        const content =
          event.result && typeof event.result === 'object'
            ? (event.result as { content?: unknown }).content
            : event.result
        cb.onStep(
          withParent(
            stepFromToolResult({
              toolUseId: event.toolCallId,
              toolName: meta.name,
              toolInput: meta.input,
              content,
              isError: event.isError === true,
            }),
          ),
        )
        break
      }
      case 'agent_end': {
        const last = [...event.messages].reverse().find(isAssistant)
        if (last) {
          const text = assistantText(last)
          if (text) acc.text = text // authoritative final text
          if (last.model) acc.modelUsed = last.model
          acc.inputTokens = last.usage.input
          acc.outputTokens = last.usage.output
          acc.stopReason = last.stopReason
        }
        break
      }
      default:
        break
    }
  }

  return { handle, result: () => acc }
}
