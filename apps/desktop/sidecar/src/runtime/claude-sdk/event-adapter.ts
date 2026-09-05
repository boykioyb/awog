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
import { parseTodos } from '../todos.js'
import type { StreamCallbacks } from '../../sessions/runner.js'
import type { SessionStep, TodoItem } from '../../types/shared.js'

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
  // Push a fresh output tail into a running background task's row (run-stream owns
  // the polling; the adapter owns how the row looks).
  updateBackgroundOutput: (taskId: string, output: string) => void
  // Tell the adapter this task is real BACKGROUND work (run-stream owns the CLI's
  // level signal, the only place that distinction exists).
  markBackgroundTask: (taskId: string) => void
  // Close a row whose task was still running when the turn ended.
  settleBackgroundRow: (taskId: string) => void
}

// Optional side-channels the runner owns. `onTodos` is the SDK-path twin of the
// Pi tool layer's `todoSink`: TodoWrite is an SDK built-in here, so the tool_use
// event is the ONLY place AWOG can see the model's checklist and persist it as
// the session's authoritative list (ADR 0069). Kept as a callback rather than a
// store import so the adapter stays a pure event translator.
export interface ClaudeAdapterHooks {
  onTodos?: (todos: TodoItem[]) => void
  // Tail of a finished background task's `output_file` (claude-sdk/task-output.ts).
  // A side channel for the same reason as onTodos: reading a file is not the
  // translator's job, but without it a finished background shell can only say
  // "completed" while its actual output sits on disk.
  readTaskOutput?: (file: string, taskId: string) => string | undefined
}

// Live view of one CLI background task, folded from its event stream.
interface BgTaskView {
  name?: string
  subagentType?: string
  // Progress descriptions in order ("Reading foo.ts"), newest last, tail-capped.
  activity: string[]
  lastToolName?: string
  usage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number }
  // The tool_use that launched it — also this row's step id, so the task's own steps
  // (they carry it as `parentId`) nest under the row instead of a separate one.
  toolUseId?: string
  // Tail of the task's output file WHILE it runs (run-stream polls it — the CLI
  // sends no progress events for a shell), so a long `pytest` is watchable instead
  // of a silent row. Replaced by the final read when the task settles.
  liveOutput?: string
  // Set once the notification arrived: later polls must not resurrect the row.
  settled?: boolean
}

// How many progress lines a row keeps. Enough to see what a subagent has been
// doing, bounded because every step is persisted to the session JSONL.
const BG_ACTIVITY_LINES = 12

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k tokens` : `${n} tokens`
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

// The expandable body of a background-task row: what it has been doing, how much
// work that took, and — once finished — its summary and captured output.
function bgTaskBody(
  view: BgTaskView,
  summary: string | undefined,
  output: string | undefined,
): string {
  const blocks: string[] = []
  if (view.activity.length > 0) blocks.push(view.activity.join('\n'))
  const stats: string[] = []
  if (view.lastToolName) stats.push(view.lastToolName)
  if (view.usage?.tool_uses !== undefined) stats.push(`${view.usage.tool_uses} tool calls`)
  if (view.usage?.duration_ms !== undefined) stats.push(formatDuration(view.usage.duration_ms))
  if (view.usage?.total_tokens !== undefined) stats.push(formatTokens(view.usage.total_tokens))
  if (stats.length > 0) blocks.push(stats.join(' · '))
  if (summary) blocks.push(summary)
  if (output) blocks.push(output.trimEnd())
  return blocks.join('\n\n')
}

export function createClaudeEventAdapter(
  cb: StreamCallbacks,
  hooks: ClaudeAdapterHooks = {},
): ClaudeEventAdapter {
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
  // task_id → everything known about its background-task row, accumulated across
  // the started → progress → notification events (see emitBackgroundTask).
  const bgTasks = new Map<string, BgTaskView>()
  // Reverse index of the same relation, for the tool_result path.
  const taskIdByToolUse = new Map<string, string>()
  // Task ids the CLI reported as live BACKGROUND work (its `background_tasks_changed`
  // level signal, forwarded by run-stream). The started/progress/notification events
  // alone can't tell background from foreground.
  const backgroundTaskIds = new Set<string>()
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
      // Persist as the session's current checklist. Only the MAIN agent's list is
      // the session checklist — a subagent (parent_tool_use_id set) keeps its own
      // scratch list, mirroring the Pi path where subagents get no sink.
      if (!parentId) {
        const items = parseTodos(input.todos)
        if (items.length) hooks.onTodos?.(items)
      }
      return
    }
    cb.onStep(wp(stepFromToolUse({ id: block.id, name: block.name, input })))
  }

  // Background task lifecycle → ONE upserted step, so a task the model left running
  // is visible while it works instead of vanishing behind an already-'done' row.
  //
  // The row is keyed by the LAUNCHING `tool_use_id` (not the task id) so it MERGES
  // with the Task/Bash step that started it: the subagent's own tool calls arrive as
  // separate steps carrying that same id as `parentId`, so merging is what puts the
  // step list, the progress log and the result on ONE row. `skip_transcript` marks
  // ambient/housekeeping tasks the CLI wants hidden.
  const emitBackgroundTask = (m: {
    subtype?: string
    task_id?: string
    tool_use_id?: string
    description?: string
    subagent_type?: string
    summary?: string
    status?: string
    output_file?: string
    last_tool_name?: string
    usage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number }
    skip_transcript?: boolean
  }): void => {
    if (!cb.onStep || !m.task_id || m.skip_transcript) return
    const kind = m.subtype
    if (kind !== 'task_started' && kind !== 'task_progress' && kind !== 'task_notification') return
    const view = bgTasks.get(m.task_id) ?? { activity: [] }
    bgTasks.set(m.task_id, view)
    if (m.tool_use_id) {
      view.toolUseId = m.tool_use_id
      taskIdByToolUse.set(m.tool_use_id, m.task_id)
    }
    // Only task_started's description NAMES the task. On task_progress the same
    // field is the live activity ("Reading foo.ts") — appended to the log below, not
    // promoted to the label — and task_notification carries neither name nor type,
    // so both are remembered here or the settling upsert would rename a named row
    // back to a bare "Background task".
    if (m.subagent_type) view.subagentType = m.subagent_type
    if (kind === 'task_started' && m.description) view.name = m.description
    if (kind === 'task_progress') {
      if (m.description && m.description !== view.activity.at(-1)) {
        view.activity.push(m.description)
        // Keep the tail: the row is a live progress log, not an audit trail.
        if (view.activity.length > BG_ACTIVITY_LINES) view.activity.shift()
      }
      if (m.last_tool_name) view.lastToolName = m.last_tool_name
      if (m.usage) view.usage = m.usage
    }
    if (kind === 'task_notification' && m.usage) view.usage = m.usage

    // The final read replaces whatever the poll last saw — same file, now complete.
    const finished = kind === 'task_notification'
    if (finished) {
      view.settled = true
      if (!view.subagentType && m.output_file) {
        const finalOutput = hooks.readTaskOutput?.(m.output_file, m.task_id)
        if (finalOutput !== undefined) view.liveOutput = finalOutput
      }
    }
    emitBgStep(m.task_id, view, {
      status: !finished ? 'running' : m.status === 'completed' ? 'done' : 'error',
      ...(finished && m.summary ? { summary: m.summary } : {}),
    })
  }

  // Upsert the row for one background task. A shell renders as a terminal block (its
  // output is plain text); a subagent renders as text — its own tool calls stream in
  // as nested steps under this same row, so the row itself carries the progress log
  // and the result.
  //
  // "Background" is only claimed for a task the CLI reported through its level signal
  // (markBackgroundTask): a FOREGROUND subagent emits the very same started/progress/
  // notification events, and calling that one "background" would be a lie. The
  // foreground row also ends up owned by the Task tool_result (it arrives after the
  // notification and carries the real report), which is the behaviour it always had —
  // it just gains a live progress log while it runs.
  const emitBgStep = (
    taskId: string,
    view: BgTaskView,
    opts: { status: 'running' | 'done' | 'error'; summary?: string },
  ): void => {
    if (!cb.onStep) return
    const isBackground = backgroundTaskIds.has(taskId)
    // The raw command beats the CLI's paraphrase for a shell row — the adapter
    // already holds the launching tool's input.
    const command =
      view.toolUseId !== undefined
        ? ((toolInputs.get(view.toolUseId)?.input.command as string | undefined) ?? view.name)
        : view.name
    const step: SessionStep = {
      id: view.toolUseId ?? `bgtask-${taskId}`,
      kind: 'tool',
      tool: view.subagentType ? 'task' : 'terminal',
      label: view.subagentType
        ? `${isBackground ? 'Background agent' : 'Agent'}: ${view.subagentType}`
        : 'Background task',
      status: opts.status,
    }
    const target = view.subagentType ? view.name : command
    if (target) step.target = target
    const body = bgTaskBody(view, opts.summary, view.liveOutput)
    if (body) {
      step.detail = view.subagentType
        ? { kind: 'text', content: body }
        : { kind: 'terminal', command: command ?? 'background task', output: body }
    }
    cb.onStep(step)
  }

  // run-stream saw this task in the CLI's background level signal. Re-renders the row
  // when it already exists, so a row drawn from an earlier event drops the foreground
  // wording as soon as we learn better.
  const markBackgroundTask = (taskId: string): void => {
    if (backgroundTaskIds.has(taskId)) return
    backgroundTaskIds.add(taskId)
    const view = bgTasks.get(taskId)
    if (view && !view.settled) emitBgStep(taskId, view, { status: 'running' })
  }

  // The turn ended with this task still running (the CLI process dies with the turn,
  // so it cannot finish). Without this the row would stay 'running' forever in the
  // persisted transcript — a spinner on a conversation that is over.
  const settleBackgroundRow = (taskId: string): void => {
    const view = bgTasks.get(taskId)
    if (!view || view.settled) return
    view.settled = true
    emitBgStep(taskId, view, {
      status: 'error',
      summary: 'The turn ended before this finished, so it was stopped.',
    })
  }

  // Fresh output tail for a STILL-RUNNING background shell (run-stream's poll).
  // Ignored once the task settled so a late poll can't reopen a finished row.
  const updateBackgroundOutput = (taskId: string, output: string): void => {
    const view = bgTasks.get(taskId)
    if (!view || view.settled || view.liveOutput === output) return
    view.liveOutput = output
    emitBgStep(taskId, view, { status: 'running' })
  }

  const emitToolResult = (block: ContentBlock, parentId: string | undefined): void => {
    if (!cb.onStep || typeof block.tool_use_id !== 'string') return
    const meta = toolInputs.get(block.tool_use_id) ?? { name: 'tool', input: {} }
    // Every skip below applies to a SUCCESSFUL result only. An error must always
    // reach the transcript: silently dropping it renders a failed call as a healthy
    // step, which is exactly how a rejected TodoWrite looked like a working
    // checklist for a month of sessions.
    const failed = block.is_error === true
    // ExitPlanMode / TodoWrite already rendered their step on the tool_use; a
    // successful result is an internal ack — don't overwrite it with a generic row.
    if ((meta.name === 'ExitPlanMode' || meta.name === 'TodoWrite') && !failed) return
    // A BACKGROUNDED tool returns immediately with a launch ack ("Command running in
    // background with ID …", "Async agent launched successfully" — the CLI itself
    // tells the model not to quote it). The background row owns this id and shows the
    // real progress/output, so the ack must not overwrite it. A FOREGROUND subagent is
    // untouched here: its result IS the report. A failed launch is not an ack and
    // owns nothing, so it falls through.
    const bgTaskId = taskIdByToolUse.get(block.tool_use_id)
    if (bgTaskId !== undefined && backgroundTaskIds.has(bgTaskId) && !failed) return
    cb.onStep(
      withParent(parentId)(
        stepFromToolResult({
          toolUseId: block.tool_use_id,
          toolName: meta.name,
          toolInput: meta.input,
          content: block.content,
          isError: failed,
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
        const m = msg as {
          subtype?: string
          model?: string
          task_id?: string
          description?: string
          subagent_type?: string
          summary?: string
          status?: string
          output_file?: string
          last_tool_name?: string
          usage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number }
          skip_transcript?: boolean
        }
        if (m.subtype === 'init' && typeof m.model === 'string') acc.modelUsed = m.model
        else emitBackgroundTask(m)
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

  return {
    handle,
    result: () => acc,
    updateBackgroundOutput,
    markBackgroundTask,
    settleBackgroundRow,
  }
}
