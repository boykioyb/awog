// Craft-parity turn model (ADR 0061, Pha 2). Pure functions that derive a
// craft-style "turn view" from AWOG's existing AssistantMessage.blocks — WITHOUT
// changing the store/persistence shape. This is the framework-agnostic core ported
// from craft's turn-utils.ts (deriveTurnPhase / blockRole / finalResponseIndex /
// getPreviewText), adapted to AWOG's block union.
//
// Craft groups a FLAT Message[] into turns via groupMessagesByTurn(); AWOG is
// already turn-grouped (one AssistantMessage === one turn, its steps live in
// `blocks`), so we operate on a single message's blocks instead. The other craft
// insight carries over verbatim: intermediate text (commentary before a tool) vs
// the final response is derived from block ORDER, not a persisted flag — so no
// sidecar/JSONL change is needed.

import type { AssistantMessage, AssistantBlock, StepBlock } from '~/composables/useSessionsData'

// A minimal translator signature (matches vue-i18n's `t` named-params form),
// injected so this module stays pure/testable and free of composable calls.
export type Translate = (key: string, params?: Record<string, string | number>) => string

// ============================================================================
// Turn lifecycle phase (ported from craft turn-utils.ts:118-189)
// ============================================================================

export type TurnPhase =
  | 'pending' // turn created, no activity yet
  | 'tool_active' // at least one tool step is running
  | 'awaiting' // has activity but nothing running/streaming — the GAP between a tool finishing and the next action
  | 'streaming' // the final response text is actively streaming
  | 'complete' // turn finished

function isStep(b: AssistantBlock): b is StepBlock {
  return b.kind === 'step'
}
// A non-TodoWrite tool step (the checklist carrier renders in the docked banner /
// inline todo, never as an activity row).
function isActivityStep(b: AssistantBlock): b is StepBlock {
  return isStep(b) && !b.todos
}

// Index into `blocks` of the turn's FINAL response text — the last text run with no
// tool/gate work after it. -1 when the turn has no clean final answer yet (e.g. it
// currently ends on a running tool, or on intermediate commentary). Mirrors craft's
// "text with a terminal stop_reason is the response; text before a tool is
// intermediate", derived here from order.
export function finalResponseIndex(blocks: AssistantBlock[]): number {
  let lastText = -1
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i]?.kind === 'text') {
      lastText = i
      break
    }
  }
  if (lastText < 0) return -1
  // Any tool/gate block AFTER the last text means the turn isn't "answering" — the
  // trailing text was commentary and more work followed.
  for (let i = lastText + 1; i < blocks.length; i++) {
    const k = blocks[i]?.kind
    if (k === 'step' || k === 'plan' || k === 'question' || k === 'perm' || k === 'error') {
      return -1
    }
  }
  return lastText
}

// The text block to render as the prominent RESPONSE (outside the collapsed activities),
// or -1. Refines finalResponseIndex with a streaming guard: while a TOOL-using turn is
// still streaming, a trailing text is ambiguous — it may be commentary before the next
// tool ("Now I'll switch X to Y:") that hasn't streamed in yet — so we DON'T promote it
// to the response; it stays inside the activities until the turn completes. A pure-text
// turn (no tools) always shows its answer live.
export function responseIndex(blocks: AssistantBlock[], isStreaming: boolean): number {
  const idx = finalResponseIndex(blocks)
  if (idx < 0) return -1
  if (isStreaming && blocks.some((b) => b.kind === 'step')) return -1
  return idx
}

export function deriveTurnPhase(m: AssistantMessage): TurnPhase {
  if (!m.streaming) return 'complete'
  const blocks = m.blocks
  const lastIdx = blocks.length - 1
  const last = blocks[lastIdx]
  // Final response is actively streaming = the last block IS the (promotable) answer text.
  if (last && last.kind === 'text' && responseIndex(blocks, true) === lastIdx) return 'streaming'
  // Any tool currently running.
  if (blocks.some((b) => isStep(b) && b.status === 'running')) return 'tool_active'
  // Has activity but nothing running/streaming — the gap.
  if (blocks.length > 0) return 'awaiting'
  return 'pending'
}

// ============================================================================
// Block roles — how each block is bucketed for rendering
// ============================================================================

// response  → the prominent final answer bubble (always visible)
// activity  → collapsible row (tool step, thinking, or intermediate commentary text)
// gate      → interactive card rendered in place (plan / question / perm / steer / error)
// todo      → a TodoWrite carrier step (handled by the docked banner / inline todo)
export type BlockRole = 'response' | 'activity' | 'gate' | 'todo'

export function blockRole(block: AssistantBlock, index: number, finalIdx: number): BlockRole {
  if (block.kind === 'text') return index === finalIdx ? 'response' : 'activity'
  if (block.kind === 'thinking') return 'activity'
  if (block.kind === 'step') return block.todos ? 'todo' : 'activity'
  return 'gate' // plan | question | perm | steer | error
}

// ============================================================================
// Collapsed-header preview text (adapted from craft TurnCard.tsx:709-774)
// ============================================================================

// A short, human label for a running/notable step, used in the collapsed preview.
// AWOG blocks carry `tool` (category) + `target` (file / command / query / task
// description); prefer the concrete target, fall back to the category.
function stepLabel(b: StepBlock): string {
  return (b.target && b.target.trim()) || b.tool
}

// The primary preview shown in the collapsed turn header. Priority mirrors craft:
// responding → running Task description → running tool names → latest intermediate
// commentary → "Steps completed" (+ error count) → "Starting".
export function getPreviewText(blocks: AssistantBlock[], phase: TurnPhase, t: Translate): string {
  // Final response is streaming → "Responding…"
  if (phase === 'streaming') return t('sessions.turn.responding')

  const errorCount = blocks.filter((b) => isStep(b) && b.status === 'error').length
  const errorSuffix = errorCount > 0 ? t('sessions.turn.errorCount', { count: errorCount }) : ''

  // A running Task subagent → show its description (the most informative thing).
  const runningTask = blocks.find(
    (b): b is StepBlock => isStep(b) && b.tool === 'task' && b.status === 'running',
  )
  if (runningTask && stepLabel(runningTask)) return stepLabel(runningTask)

  // Running tools → their targets/labels (max 3).
  const running = blocks.filter((b): b is StepBlock => isActivityStep(b) && b.status === 'running')
  if (running.length > 0) {
    return `${running.slice(0, 3).map(stepLabel).join(', ')}…`
  }

  // Still streaming (not the final answer yet) → the latest intermediate commentary,
  // so the header reflects what the model is currently saying.
  if (phase !== 'complete') {
    const finalIdx = finalResponseIndex(blocks)
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i]
      if (b && b.kind === 'text' && i !== finalIdx && b.text.trim()) return b.text.trim()
    }
  }

  // Complete (or settled with activities) → the count badge already shows how many,
  // so the label is just "Steps completed" (+ any error count).
  if (phase === 'complete' || blocks.length > 0) {
    return `${t('sessions.turn.stepsCompleted')}${errorSuffix}`
  }

  return t('sessions.turn.starting')
}

// Note: token/duration formatting reuses the existing `formatTokens` from
// composables/useActivity.ts (do not re-export a duplicate — it would shadow that
// one app-wide via Nuxt auto-import). A per-tool duration formatter is added in
// Pha 5 when steps start carrying elapsed time.
