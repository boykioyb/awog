// Codex app-server notifications → AWOG stream callbacks (ADR 0087).
//
// The shape maps almost straight across: Codex emits `item/started` and
// `item/completed` around every unit of work, which is the running → done upsert
// the session timeline already expects. So the adapter's job is mostly naming:
// a Codex `commandExecution` is rendered through the SAME step-mapper call a
// Claude/Pi `Bash` goes through, which is what keeps one session list looking
// like one product across three runtimes.
//
// Text is accumulated from DELTAS only. `item/completed` carries the whole
// message again, and taking it would re-append text the user has already seen —
// the same rule the Pi adapter states for agent_end, and the reason step
// textOffsets stay aligned with the reply.

import type { SessionStep } from '../../types/shared.js'
import {
  stepFromThinking,
  stepFromToolResult,
  stepFromToolUse,
  type ToolUseInfo,
} from '../../sessions/step-mapper.js'
import type {
  CodexThreadItem,
  CodexThreadTokenUsage,
  CodexTokenUsageBreakdown,
  CodexTurn,
} from './protocol.js'
import { CODEX_NOTIFICATIONS } from './protocol.js'
import { fromCodexToolName } from './dynamic-tools.js'
import { log } from '../../util/logger.js'

export interface CodexTurnOutcome {
  status: 'completed' | 'interrupted' | 'failed'
  errorMessage?: string
}

export interface CodexAccumulator {
  text: string
  /** Summed over the turn's requests — see `onTokenUsage`. */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Prompt size of the LAST request of the turn (the context-window gauge). */
  contextTokens: number
  /** Prompt size of the FIRST request (the standing cost before tool results). */
  baseTokens: number
  turnId?: string
  outcome?: CodexTurnOutcome
}

export function createCodexAccumulator(): CodexAccumulator {
  return {
    text: '',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    contextTokens: 0,
    baseTokens: 0,
  }
}

// Codex item → the AWOG tool identity that renders it. Using AWOG's own tool
// names (which are Claude Code's) means pickStepTool/pickTarget already know how
// to label and target the row — a Codex shell command shows up as a terminal
// step with the command on it, exactly like a Bash call on the other runtimes.
function toolUseFromItem(item: CodexThreadItem): ToolUseInfo | undefined {
  switch (item.type) {
    case 'commandExecution': {
      const cmd = item as Extract<CodexThreadItem, { type: 'commandExecution' }>
      return { id: cmd.id, name: 'Bash', input: { command: cmd.command } }
    }
    case 'fileChange': {
      const fc = item as Extract<CodexThreadItem, { type: 'fileChange' }>
      const first = fc.changes[0]
      // Codex reports one item for a patch that may touch several files. The row
      // names the first and counts the rest rather than inventing N steps the
      // server never separated.
      const target = first?.path ?? ''
      const extra = fc.changes.length > 1 ? ` (+${fc.changes.length - 1} more)` : ''
      return { id: fc.id, name: 'Edit', input: { file_path: `${target}${extra}` } }
    }
    case 'dynamicToolCall': {
      const dt = item as Extract<CodexThreadItem, { type: 'dynamicToolCall' }>
      return {
        // Back to the AWOG name: `mcp__` is reserved on the wire, so a bridged
        // MCP tool travels as `awogmcp__…` and must NOT reach the step mapper
        // that way — the transcript labels MCP rows by that prefix.
        id: dt.id,
        name: fromCodexToolName(dt.tool),
        input: (dt.arguments ?? {}) as Record<string, unknown>,
      }
    }
    case 'mcpToolCall': {
      const mt = item as Extract<CodexThreadItem, { type: 'mcpToolCall' }>
      // Same `mcp__<server>__<tool>` convention the rest of AWOG keys off.
      return { id: mt.id, name: `mcp__${mt.server}__${mt.tool}`, input: {} }
    }
    case 'webSearch': {
      const ws = item as Extract<CodexThreadItem, { type: 'webSearch' }>
      return { id: ws.id, name: 'WebSearch', input: { query: ws.query ?? '' } }
    }
    default:
      return undefined
  }
}

function resultContent(item: CodexThreadItem): { content: unknown; isError: boolean } {
  switch (item.type) {
    case 'commandExecution': {
      const cmd = item as Extract<CodexThreadItem, { type: 'commandExecution' }>
      return {
        content: cmd.aggregatedOutput ?? '',
        isError: cmd.status === 'failed' || (cmd.exitCode ?? 0) !== 0,
      }
    }
    case 'dynamicToolCall': {
      const dt = item as Extract<CodexThreadItem, { type: 'dynamicToolCall' }>
      const text = (dt.contentItems ?? [])
        .map((c) => (c.type === 'inputText' ? c.text : '[image]'))
        .join('\n')
      return { content: text, isError: dt.status === 'failed' || dt.success === false }
    }
    case 'fileChange': {
      const fc = item as Extract<CodexThreadItem, { type: 'fileChange' }>
      return {
        content: fc.changes.map((c) => c.path).join('\n'),
        isError: fc.status === 'failed',
      }
    }
    default:
      return { content: '', isError: false }
  }
}

function sumPrompt(u: CodexTokenUsageBreakdown): number {
  return u.inputTokens + u.cachedInputTokens + u.cacheWriteInputTokens
}

export interface CodexAdapterCallbacks {
  onChunk: (delta: string) => void
  onStep?: (step: SessionStep) => void
  /** Fires once when the turn reaches a terminal state. */
  onTurnEnd: (outcome: CodexTurnOutcome) => void
}

export interface CodexEventAdapter {
  handle: (method: string, params: Record<string, unknown>) => void
  acc: CodexAccumulator
}

export function createCodexEventAdapter(cb: CodexAdapterCallbacks): CodexEventAdapter {
  const acc = createCodexAccumulator()
  // Item ids whose text already reached the user through deltas, so the
  // completed item is not appended a second time.
  const streamedMessages = new Set<string>()
  // Reasoning text per item id, rebuilt from deltas so the thinking row grows
  // in place instead of emitting one row per delta.
  const reasoning = new Map<string, string>()
  let ended = false

  const end = (outcome: CodexTurnOutcome): void => {
    if (ended) return
    ended = true
    acc.outcome = outcome
    cb.onTurnEnd(outcome)
  }

  const handle = (method: string, params: Record<string, unknown>): void => {
    switch (method) {
      case CODEX_NOTIFICATIONS.turnStarted: {
        const turn = params.turn as CodexTurn | undefined
        if (turn?.id) acc.turnId = turn.id
        break
      }

      case CODEX_NOTIFICATIONS.agentMessageDelta: {
        const delta = params.delta
        const itemId = params.itemId
        if (typeof delta !== 'string' || delta.length === 0) break
        if (typeof itemId === 'string') streamedMessages.add(itemId)
        acc.text += delta
        cb.onChunk(delta)
        break
      }

      case CODEX_NOTIFICATIONS.reasoningTextDelta:
      case CODEX_NOTIFICATIONS.reasoningSummaryDelta: {
        const delta = params.delta
        const itemId = params.itemId
        if (typeof delta !== 'string' || typeof itemId !== 'string') break
        const next = (reasoning.get(itemId) ?? '') + delta
        reasoning.set(itemId, next)
        cb.onStep?.(stepFromThinking(itemId, next))
        break
      }

      case CODEX_NOTIFICATIONS.itemStarted: {
        const item = params.item as CodexThreadItem | undefined
        if (!item) break
        const use = toolUseFromItem(item)
        if (use) cb.onStep?.(stepFromToolUse(use))
        break
      }

      case CODEX_NOTIFICATIONS.itemCompleted: {
        const item = params.item as CodexThreadItem | undefined
        if (!item) break
        if (item.type === 'agentMessage') {
          const msg = item as Extract<CodexThreadItem, { type: 'agentMessage' }>
          // Only when no delta carried it — a server that answered in one shot
          // (or a resumed thread replaying an item) still has to reach the user.
          if (!streamedMessages.has(msg.id) && msg.text) {
            acc.text += msg.text
            cb.onChunk(msg.text)
          }
          break
        }
        if (item.type === 'reasoning') {
          const r = item as Extract<CodexThreadItem, { type: 'reasoning' }>
          const text = [...r.summary, ...r.content].filter(Boolean).join('\n\n')
          if (text) cb.onStep?.(stepFromThinking(r.id, text, true))
          break
        }
        const use = toolUseFromItem(item)
        if (!use) break
        const { content, isError } = resultContent(item)
        cb.onStep?.(
          stepFromToolResult({
            toolUseId: use.id,
            toolName: use.name,
            toolInput: use.input,
            content,
            isError,
          }),
        )
        break
      }

      case CODEX_NOTIFICATIONS.tokenUsage: {
        const usage = params.tokenUsage as CodexThreadTokenUsage | undefined
        if (!usage) break
        // `last` is the most recent REQUEST's usage; a turn makes several. Summing
        // `last` across the turn's notifications gives the turn total, while
        // `total` on this payload is the THREAD's running total and would
        // re-report every earlier turn. The two prompt-size fields the gauge
        // needs come off `last` directly: the first one seen is the standing
        // cost, the newest is current occupancy.
        acc.inputTokens += usage.last.inputTokens
        acc.outputTokens += usage.last.outputTokens
        acc.cacheReadTokens += usage.last.cachedInputTokens
        acc.cacheWriteTokens += usage.last.cacheWriteInputTokens
        const prompt = sumPrompt(usage.last)
        if (acc.baseTokens === 0) acc.baseTokens = prompt
        acc.contextTokens = prompt
        break
      }

      case CODEX_NOTIFICATIONS.error: {
        const err = params.error as { message?: string } | undefined
        const willRetry = params.willRetry === true
        // A retryable error is the server telling us it is handling it. Logging
        // it is useful; ending the turn on it would cut a turn that recovers.
        if (willRetry) {
          log.warn('codex turn error (will retry)', { message: err?.message })
          break
        }
        end({ status: 'failed', errorMessage: err?.message ?? 'Codex reported an error' })
        break
      }

      case CODEX_NOTIFICATIONS.turnCompleted: {
        const turn = params.turn as CodexTurn | undefined
        if (turn?.status === 'failed') {
          end({
            status: 'failed',
            errorMessage: turn.error?.message ?? 'The Codex turn failed',
          })
        } else if (turn?.status === 'interrupted') {
          end({ status: 'interrupted' })
        } else {
          end({ status: 'completed' })
        }
        break
      }

      // Synthetic, emitted by the daemon client when the process dies. Without
      // it a turn in flight waits for a turn/completed that can never arrive
      // (ADR 0087 F8 listed this as unverified — this is the answer).
      case 'awog/daemonExited': {
        const message = typeof params.message === 'string' ? params.message : 'codex exited'
        end({ status: 'failed', errorMessage: message })
        break
      }

      default:
        break
    }
  }

  return { handle, acc }
}
