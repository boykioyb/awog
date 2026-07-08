// Translate a Claude Agent SDK message stream (`SDKMessage`) into AWOG's
// StreamCallbacks (onChunk / onStep) and accumulate the aggregate
// RunStreamResult (ADR 0058 — dual runtime). This is the SDK-path twin of
// runtime/event-adapter.ts (Pi). It reuses the SAME step-mapper so the UI
// renders tool / thinking / plan / todo steps identically regardless of runtime
// — the SDK's built-in tool names (Read/Write/Edit/Bash/…) match the Claude Code
// names AWOG already maps, so no per-runtime UI branch is needed.
//
// Mapping:
//   stream_event content_block_delta text_delta   → cb.onChunk(delta) + acc.text
//   stream_event content_block_delta thinking_delta→ cb.onStep(thinking, running)
//   assistant  message tool_use block             → cb.onStep(tool, running)
//   user       message tool_result block          → cb.onStep(tool, done/error)
//   result     message                            → usage / stopReason / final text
//   any message with session_id                   → acc.sdkSessionId (for resume)
//
// Subagent (SDK Task) messages carry a non-null parent_tool_use_id; their steps
// are tagged with it so the UI nests them under the Task step (mirrors the Pi
// adapter's parentId behaviour).

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  stepFromPlan,
  stepFromThinking,
  stepFromTodos,
  stepFromToolResult,
  stepFromToolUse,
} from '../../sessions/step-mapper.js'
import type { StreamCallbacks } from '../../sessions/runner.js'
import type { SessionStep } from '../../types/shared.js'

export interface ClaudeAccumulator {
  text: string
  modelUsed: string
  inputTokens: number
  outputTokens: number
  // Prompt-cache buckets (Anthropic). History is served from cache, so it lands
  // in cacheRead — the UI sums all four for true context-window occupancy.
  cacheReadTokens: number
  cacheWriteTokens: number
  stopReason: string | null
  errorMessage?: string
  // Latest SDK session id seen this turn — the caller persists it so the next
  // turn resumes the same SDK session (conversation history + native compaction).
  sdkSessionId?: string
}

// Content-block / stream-event fields we read, narrowed from the SDK's Beta
// types (kept loose so a minor SDK shape change doesn't break the build).
interface ContentBlock {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

function toInputRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
}

export interface ClaudeEventAdapter {
  handle: (msg: SDKMessage) => void
  result: () => ClaudeAccumulator
}

export function createClaudeEventAdapter(cb: StreamCallbacks): ClaudeEventAdapter {
  const acc: ClaudeAccumulator = {
    text: '',
    modelUsed: '',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    stopReason: null,
  }
  // toolCallId → { name, input } captured on the tool_use block so the matching
  // tool_result step can re-derive its target/diff stats without re-parsing.
  const toolInputs = new Map<string, { name: string; input: Record<string, unknown> }>()
  // Extended-thinking text accumulated per streamed content-block index so each
  // delta upserts the same 'thinking' step in place. Bumped per assistant turn
  // (message_start) so successive iterations keep distinct reasoning blocks.
  const thinkingBlocks = new Map<string, string>()
  let assistantSeq = 0

  const withParent =
    (parentId: string | undefined) =>
    (step: SessionStep): SessionStep =>
      parentId ? { ...step, parentId } : step

  const emitToolUse = (block: ContentBlock, parentId: string | undefined): void => {
    if (!cb.onStep || typeof block.id !== 'string' || typeof block.name !== 'string') return
    const input = toInputRecord(block.input)
    toolInputs.set(block.id, { name: block.name, input })
    const wp = withParent(parentId)
    // ExitPlanMode → plan card; TodoWrite → inline checklist (both SDK built-ins).
    if (block.name === 'ExitPlanMode') {
      const plan = typeof input.plan === 'string' ? input.plan : ''
      cb.onStep(wp(stepFromPlan(block.id, plan)))
      return
    }
    if (block.name === 'TodoWrite') {
      cb.onStep(wp(stepFromTodos('todo-list', input.todos)))
      return
    }
    cb.onStep(wp(stepFromToolUse({ id: block.id, name: block.name, input })))
  }

  const emitToolResult = (block: ContentBlock, parentId: string | undefined): void => {
    if (!cb.onStep || typeof block.tool_use_id !== 'string') return
    const meta = toolInputs.get(block.tool_use_id) ?? { name: 'tool', input: {} }
    // ExitPlanMode / TodoWrite already rendered their step on the tool_use; their
    // result is an internal ack — don't overwrite it with a generic tool row.
    if (meta.name === 'ExitPlanMode' || meta.name === 'TodoWrite') return
    cb.onStep(
      withParent(parentId)(
        stepFromToolResult({
          toolUseId: block.tool_use_id,
          toolName: meta.name,
          toolInput: meta.input,
          content: block.content,
          isError: block.is_error === true,
        }),
      ),
    )
  }

  const handle = (msg: SDKMessage): void => {
    // Capture the SDK session id (present on most message frames) for resume.
    const sid = (msg as { session_id?: unknown }).session_id
    if (typeof sid === 'string' && sid) acc.sdkSessionId = sid

    switch (msg.type) {
      case 'system': {
        const m = msg as { subtype?: string; model?: string }
        if (m.subtype === 'init' && typeof m.model === 'string') acc.modelUsed = m.model
        break
      }
      case 'stream_event': {
        const ev = (
          msg as {
            event?: {
              type?: string
              index?: number
              delta?: { type?: string; text?: string; thinking?: string }
            }
          }
        ).event
        if (!ev) break
        const blockKey = (): string => `${assistantSeq}-${typeof ev.index === 'number' ? ev.index : 0}`
        if (ev.type === 'message_start') {
          assistantSeq += 1
        } else if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'text_delta' && ev.delta.text) {
            acc.text += ev.delta.text
            cb.onChunk(ev.delta.text)
          } else if (ev.delta.type === 'thinking_delta' && cb.onStep) {
            // Extended-thinking delta → a 'thinking' step carrying the reasoning
            // text. We request `display: 'summarized'` (shared.ts thinkingFromLevel)
            // so the text arrives on both API-key AND subscription (OAuth) accounts.
            // Still emit a running step when a delta is EMPTY (some frames are pure
            // `estimated_tokens` pings): stepFromThinking labels it "Thinking…" so
            // the UI shows the model is reasoning until real text merges in.
            const key = blockKey()
            const next = (thinkingBlocks.get(key) ?? '') + (ev.delta.thinking ?? '')
            thinkingBlocks.set(key, next)
            cb.onStep(stepFromThinking(`thinking-${key}`, next))
          }
        } else if (ev.type === 'content_block_stop' && cb.onStep) {
          // A thinking block finished → mark its step done so the UI collapses it.
          const key = blockKey()
          if (thinkingBlocks.has(key)) {
            cb.onStep(stepFromThinking(`thinking-${key}`, thinkingBlocks.get(key) ?? '', true))
          }
        }
        break
      }
      case 'assistant': {
        // Tool calls from the full assistant message (complete input). Text is
        // streamed via stream_event text_delta above, so text blocks are ignored
        // here to avoid double-counting.
        const m = msg as { message?: { content?: unknown }; parent_tool_use_id?: string | null }
        const parentId = m.parent_tool_use_id ?? undefined
        const content = m.message?.content
        if (Array.isArray(content)) {
          for (const raw of content as ContentBlock[]) {
            if (raw.type === 'tool_use') emitToolUse(raw, parentId)
          }
        }
        break
      }
      case 'user': {
        // Tool results arrive as a user message with tool_result content blocks.
        const m = msg as { message?: { content?: unknown }; parent_tool_use_id?: string | null }
        const parentId = m.parent_tool_use_id ?? undefined
        const content = m.message?.content
        if (Array.isArray(content)) {
          for (const raw of content as ContentBlock[]) {
            if (raw.type === 'tool_result') emitToolResult(raw, parentId)
          }
        }
        break
      }
      case 'result': {
        const m = msg as {
          subtype?: string
          result?: string
          stop_reason?: string | null
          usage?: {
            input_tokens?: number
            output_tokens?: number
            cache_read_input_tokens?: number
            cache_creation_input_tokens?: number
          }
          modelUsage?: Record<string, unknown>
        }
        if (m.usage) {
          acc.inputTokens = m.usage.input_tokens ?? 0
          acc.outputTokens = m.usage.output_tokens ?? 0
          acc.cacheReadTokens = m.usage.cache_read_input_tokens ?? 0
          acc.cacheWriteTokens = m.usage.cache_creation_input_tokens ?? 0
        }
        if (m.subtype === 'success') {
          acc.stopReason = m.stop_reason ?? 'end_turn'
          // Streamed deltas are authoritative; fall back to the final result text
          // only when nothing streamed (e.g. includePartialMessages disabled).
          if (!acc.text && typeof m.result === 'string') acc.text = m.result
        } else {
          acc.stopReason = 'error'
          if (typeof m.result === 'string' && m.result) acc.errorMessage = m.result
        }
        if (!acc.modelUsed && m.modelUsage) {
          const first = Object.keys(m.modelUsage)[0]
          if (first) acc.modelUsed = first
        }
        break
      }
      default:
        break
    }
  }

  return { handle, result: () => acc }
}
