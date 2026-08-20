// Mapping from Claude Agent SDK tool_use/tool_result events to the UI's
// SessionStep shape. UI's StepItem.vue uses a fixed StepTool union
// ('read' | 'write' | 'edit' | 'save' | 'search' | 'find-files' | 'terminal' |
// 'task'); SDK tool names are open-ended (Read, Edit, Write, Bash, Glob, Grep,
// WebSearch, WebFetch, NotebookEdit, Task, …). We normalise here so the sidecar
// can emit step events that the existing component renders without changes.

import type {
  PlanStatus,
  SessionQuestion,
  SessionQuestionAnswer,
  SessionQuestionOption,
  SessionStep,
  SessionStepDetail,
  SessionStepStatus,
  SessionStepTool,
} from '../types/shared.js'
import { countDone, parseTodos } from '../runtime/todos.js'
import { buildUnifiedDiff } from '../runtime/tools/text-diff.js'
import { unwrapMcpToolCall, MCP_DESCRIBE_TOOL } from '../runtime/tools/mcp-tools.js'

// Cap for inline previews and one-line labels — kept small so step payloads stay
// light over stdio and the collapsed row never bloats.
const RESULT_PREVIEW_MAX = 2_000

// Cap for the expandable file-detail pane (Read/Write `kind: 'file'`). Large
// enough that a real artifact — a plan doc, a source file — renders in full;
// only a pathological multi-hundred-KB read gets clipped. Acts as a safety net
// for in-memory + JSONL growth now that steps persist.
const FILE_DETAIL_MAX = 200_000

// Clip a long string to `max`, appending a marker only when it actually overflows.
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text
}

// Cap a string for the inline preview / one-line label. Shared by the Task
// prompt stash, the tool_result preview, and the thinking label.
function truncatePreview(text: string): string {
  return clip(text, RESULT_PREVIEW_MAX)
}

// Map of SDK built-in tool names → UI StepTool. Unknown tools fall through to
// 'task' so the step still renders (icon = sparkles).
const TOOL_NAME_MAP: Record<string, SessionStepTool> = {
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  NotebookRead: 'read',
  Bash: 'terminal',
  BashOutput: 'terminal',
  Glob: 'find-files',
  Grep: 'search',
  WebSearch: 'search',
  WebFetch: 'search',
  browser_tool: 'search',
  Task: 'task',
  TodoWrite: 'task',
  ExitPlanMode: 'task',
  EnterPlanMode: 'task',
  AskUserQuestion: 'task',
}

function pickStepTool(toolName: string): SessionStepTool {
  return TOOL_NAME_MAP[toolName] ?? 'task'
}

// Best-effort "what is this tool acting on" extraction from the tool_use input.
// We don't fail the chat if input is shaped unexpectedly — return undefined.
function pickTarget(toolName: string, input: Record<string, unknown>): string | undefined {
  // Task tool: prefer the human description; the prompt is usually too long
  // and is surfaced in detail instead.
  if (toolName === 'Task') {
    const desc = input.description
    if (typeof desc === 'string' && desc.length > 0) return desc
  }
  const fp = input.file_path
  if (typeof fp === 'string' && fp.length > 0) return fp
  const nb = input.notebook_path
  if (typeof nb === 'string' && nb.length > 0) return nb
  const path = input.path
  if (typeof path === 'string' && path.length > 0) return path
  const pattern = input.pattern
  if (typeof pattern === 'string' && pattern.length > 0) return pattern
  const cmd = input.command
  // Return the FULL command — the session timeline wraps it (StepItem timeline
  // mode), so don't pre-truncate here (that baked an ellipsis the UI can't undo).
  if (typeof cmd === 'string' && cmd.length > 0) return cmd
  const query = input.query
  if (typeof query === 'string' && query.length > 0) return query
  const url = input.url
  if (typeof url === 'string' && url.length > 0) return url
  const desc = input.description
  if (typeof desc === 'string' && desc.length > 0) return desc
  return undefined
}

// For Edit/MultiEdit, additions/deletions are inferred from the input new_string
// vs old_string line counts. Write counts the whole content as additions. This
// is a lightweight approximation; full diff stats can come later from a real
// patcher in the sidecar.
function pickDiffStats(
  toolName: string,
  input: Record<string, unknown>,
): { additions?: number; deletions?: number } {
  if (toolName === 'Write') {
    const content = input.content
    if (typeof content === 'string') {
      const lines = content.length === 0 ? 0 : content.split('\n').length
      return { additions: lines }
    }
    return {}
  }
  if (toolName === 'Edit') {
    const oldStr = typeof input.old_string === 'string' ? input.old_string : ''
    const newStr = typeof input.new_string === 'string' ? input.new_string : ''
    const adds = newStr.length === 0 ? 0 : newStr.split('\n').length
    const dels = oldStr.length === 0 ? 0 : oldStr.split('\n').length
    return { additions: adds, deletions: dels }
  }
  if (toolName === 'MultiEdit') {
    const edits = Array.isArray(input.edits) ? input.edits : []
    let adds = 0
    let dels = 0
    for (const e of edits) {
      if (typeof e !== 'object' || e === null) continue
      const rec = e as Record<string, unknown>
      const o = typeof rec.old_string === 'string' ? rec.old_string : ''
      const n = typeof rec.new_string === 'string' ? rec.new_string : ''
      if (n.length > 0) adds += n.split('\n').length
      if (o.length > 0) dels += o.split('\n').length
    }
    return { additions: adds, deletions: dels }
  }
  return {}
}

function humanLabel(toolName: string, input: Record<string, unknown>): string {
  // The label sits inline in the assistant bubble; mirror Claude Code phrasing.
  switch (toolName) {
    case 'Read':
      return 'Read'
    case 'Write':
      return 'Write'
    case 'Edit':
      return 'Edit'
    case 'MultiEdit':
      return 'Edit (multi)'
    case 'NotebookEdit':
      return 'Edit notebook'
    case 'NotebookRead':
      return 'Read notebook'
    case 'Bash':
      return 'Run'
    case 'BashOutput':
      return 'Bash output'
    case 'Glob':
      return 'Glob'
    case 'Grep':
      return 'Grep'
    case 'WebSearch':
      return 'Web search'
    case 'WebFetch':
      return 'Fetch URL'
    case 'browser_tool': {
      const action = typeof input.action === 'string' ? input.action : ''
      return action ? `Browser: ${action}` : 'Browser'
    }
    case 'Task': {
      // Format: "Agent <subagent_type>" so the step row reads like Claude Code's
      // "Ran agent X" affordance. An omitted type runs the general-purpose
      // subagent (task-tool.ts), so reflect that rather than a vague "Subagent".
      const sub = typeof input.subagent_type === 'string' ? input.subagent_type : ''
      return `Agent ${sub || 'general-purpose'}`
    }
    case 'TodoWrite':
      return 'Todos'
    case 'ExitPlanMode':
      return 'Exit plan'
    case 'EnterPlanMode':
      return 'Enter plan'
    case MCP_DESCRIBE_TOOL:
      return 'MCP: describe'
    // Wiki + memory (ADR 0073). Both name forms are listed because the Pi path uses
    // the bare name while the Claude SDK bridges the SAME tool as
    // `mcp__awogwiki__*` / `mcp__awogmemory__*` — without these the row would read
    // "awogwiki: wiki_read" on one runtime and "Wiki read" on the other.
    case 'wiki_search':
    case 'mcp__awogwiki__wiki_search':
      return 'Wiki search'
    case 'wiki_read':
    case 'mcp__awogwiki__wiki_read':
      return 'Wiki read'
    case 'wiki_write':
    case 'mcp__awogwiki__wiki_write':
      return 'Wiki write'
    case 'wiki_delete':
    case 'mcp__awogwiki__wiki_delete':
      return 'Wiki delete'
    case 'memory_remember':
    case 'mcp__awogmemory__memory_remember':
      return 'Remember'
    case 'memory_forget':
    case 'mcp__awogmemory__memory_forget':
      return 'Forget'
    case 'memory_read':
    case 'mcp__awogmemory__memory_read':
      return 'Memory'
    default: {
      // MCP tool (direct mcp__<server>__<tool>, or an unwrapped proxy mcp_call)
      // → "server: tool" instead of the raw double-underscore name (ADR 0051).
      if (toolName.startsWith('mcp__')) {
        const parts = toolName.slice('mcp__'.length).split('__')
        if (parts.length >= 2) return `${parts[0]}: ${parts.slice(1).join('__')}`
      }
      return toolName
    }
  }
}

// Build a 'note' step from a TodoWrite call's `todos` input — a structured
// checklist (step.todos) the UI renders inline rather than a generic 'task' step
// (which would open the empty subagent drawer). Emitted from the call INPUT
// (like ExitPlanMode), so the result event is ignored.
export function stepFromTodos(id: string, todos: unknown): SessionStep {
  const items = parseTodos(todos)
  const total = items.length
  const done = countDone(items)
  const step: SessionStep = {
    id,
    kind: 'note',
    label: total > 0 ? `Todos · ${done}/${total}` : 'Todos',
    status: 'done',
  }
  if (total > 0) step.todos = items
  return step
}

export interface ToolUseInfo {
  id: string
  name: string
  input: Record<string, unknown>
}

export function stepFromToolUse(rawInfo: ToolUseInfo): SessionStep {
  // Unwrap a proxy mcp_call into its underlying mcp__server__tool identity + real
  // args so it renders like a direct MCP call, not a bare "mcp_call" (ADR 0051).
  const { name, input } = unwrapMcpToolCall(rawInfo.name, rawInfo.input)
  const info: ToolUseInfo = { ...rawInfo, name, input }
  const tool = pickStepTool(info.name)
  const target = pickTarget(info.name, info.input)
  const stats = pickDiffStats(info.name, info.input)
  const step: SessionStep = {
    id: info.id,
    kind: 'tool',
    tool,
    label: humanLabel(info.name, info.input),
    status: 'running',
  }
  if (target !== undefined) step.target = target
  if (stats.additions !== undefined) step.additions = stats.additions
  if (stats.deletions !== undefined) step.deletions = stats.deletions
  // Task: stash the prompt as detail so the expand-drawer can show what the
  // subagent was asked. Truncate to keep payload small.
  if (info.name === 'Task') {
    const prompt = typeof info.input.prompt === 'string' ? info.input.prompt : ''
    if (prompt) {
      step.detail = { kind: 'text', content: truncatePreview(prompt) }
    }
  }
  return step
}

// Flatten SDK tool_result content (string | text-block array) to a single string.
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (typeof block === 'object' && block !== null) {
        const rec = block as Record<string, unknown>
        if (rec.type === 'text' && typeof rec.text === 'string') {
          parts.push(rec.text)
        }
      }
    }
    return parts.join('\n')
  }
  return ''
}

// Inline preview of a tool_result — flattened then capped small. The file-detail
// pane uses toolResultText + FILE_DETAIL_MAX instead so the user sees the whole file.
function previewToolResult(content: unknown): string {
  return truncatePreview(toolResultText(content))
}

// Strip the Read tool's `cat -n` gutter (right-aligned line number + tab, see
// runtime/tools/fs-tools.ts) from each line so the stored UI detail is the clean
// file content. Only applied to Read results, where we know the gutter is present.
function stripReadGutter(text: string): string {
  return text.replace(/^ *\d+\t/gm, '')
}

export interface ToolResultInfo {
  toolUseId: string
  toolName: string
  toolInput: Record<string, unknown>
  content: unknown
  // AgentToolResult.details — side channel. Edit/MultiEdit stash `diff` (a
  // unified diff) + `newContent` (the full file after the edit) here so the
  // step detail can render a git-style diff and a full-file view.
  details?: unknown
  isError: boolean
}

// Best-effort unified diff for an Edit/MultiEdit when the tool didn't attach one
// (e.g. older flows): diff each edit's old_string → new_string in isolation.
// No surrounding file context, so line numbers start at 1 — still renders the
// change like git. The accurate, line-aligned diff comes from `details.diff`.
function fallbackEditDiff(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Edit') {
    const oldStr = typeof input.old_string === 'string' ? input.old_string : ''
    const newStr = typeof input.new_string === 'string' ? input.new_string : ''
    return buildUnifiedDiff(oldStr, newStr)
  }
  const edits = Array.isArray(input.edits) ? input.edits : []
  const parts: string[] = []
  for (const e of edits) {
    if (typeof e !== 'object' || e === null) continue
    const rec = e as Record<string, unknown>
    const o = typeof rec.old_string === 'string' ? rec.old_string : ''
    const n = typeof rec.new_string === 'string' ? rec.new_string : ''
    const d = buildUnifiedDiff(o, n)
    if (d) parts.push(d)
  }
  return parts.join('\n')
}

export function stepFromToolResult(rawInfo: ToolResultInfo): SessionStep {
  // Same proxy unwrap as stepFromToolUse (ADR 0051): render mcp_call as its
  // underlying mcp__server__tool with real args.
  const { name, input } = unwrapMcpToolCall(rawInfo.toolName, rawInfo.toolInput)
  const info: ToolResultInfo = { ...rawInfo, toolName: name, toolInput: input }
  const status: SessionStepStatus = info.isError ? 'error' : 'done'
  const tool = pickStepTool(info.toolName)
  const target = pickTarget(info.toolName, info.toolInput)
  const stats = pickDiffStats(info.toolName, info.toolInput)
  const preview = previewToolResult(info.content)

  // Detail panel: terminal output for Bash, file dump for Read/Write, a
  // git-style diff (+ full-file view) for Edit/MultiEdit, otherwise a plain text
  // panel so the user can drill in for context.
  let detail: SessionStepDetail | undefined
  if ((info.toolName === 'Edit' || info.toolName === 'MultiEdit') && !info.isError) {
    // A failed Edit (e.g. "old_string not found in file") changed nothing, so we
    // skip the diff entirely and let it fall through to the error-text panel —
    // rendering a diff of an edit that never applied would be misleading.
    //
    // The accurate, line-aligned diff + full new file ride on the tool result
    // `details` (computed in fs-tools where both before/after are in hand).
    // Fall back to an isolated old→new diff if absent. The UI infers the
    // language for the file view from the path extension.
    const path = typeof info.toolInput.file_path === 'string' ? info.toolInput.file_path : ''
    const d =
      typeof info.details === 'object' && info.details !== null
        ? (info.details as Record<string, unknown>)
        : {}
    const diffText =
      typeof d.diff === 'string' && d.diff.length > 0
        ? d.diff
        : fallbackEditDiff(info.toolName, info.toolInput)
    const after = typeof d.newContent === 'string' ? d.newContent : undefined
    if (diffText.length > 0) {
      detail = { kind: 'diff', path, diff: clip(diffText, FILE_DETAIL_MAX) }
      if (after !== undefined) detail.content = clip(after, FILE_DETAIL_MAX)
    } else if (preview.length > 0) {
      detail = { kind: 'text', content: preview }
    }
  } else if (info.toolName === 'Bash') {
    const command = typeof info.toolInput.command === 'string' ? info.toolInput.command : ''
    detail = { kind: 'terminal', command, output: preview }
  } else if (info.toolName === 'Read') {
    // Show the full file the model read (capped only for pathological sizes), not
    // the small inline preview — the detail pane is where the user drills in.
    // Strip the Read tool's `cat -n` gutter (6-wide line number + tab) so the UI
    // detail renders the real file (markdown preview / clean raw) instead of
    // line-numbered noise. The model still receives the numbered output.
    const path = typeof info.toolInput.file_path === 'string' ? info.toolInput.file_path : ''
    const content = clip(stripReadGutter(toolResultText(info.content)), FILE_DETAIL_MAX)
    detail = { kind: 'file', path, content }
  } else if (info.toolName === 'Write') {
    // The tool result is just "Wrote N bytes to …". Show the written content
    // (from the input) instead so the detail pane renders the artifact in full.
    const path = typeof info.toolInput.file_path === 'string' ? info.toolInput.file_path : ''
    const content = typeof info.toolInput.content === 'string' ? info.toolInput.content : ''
    detail =
      content.length > 0
        ? { kind: 'file', path, content: clip(content, FILE_DETAIL_MAX) }
        : { kind: 'text', content: preview }
  } else if (info.toolName === 'Task') {
    // A subagent's returned report is a substantive artifact (like a source file
    // or plan doc), not a one-line tool result — persist it up to FILE_DETAIL_MAX
    // so the UI's "view summary" preview shows the FULL text the main agent
    // received, instead of the 2k inline clip that reads as "…(truncated)".
    const full = clip(toolResultText(info.content), FILE_DETAIL_MAX)
    if (full.length > 0) detail = { kind: 'text', content: full }
  } else if (preview.length > 0) {
    detail = { kind: 'text', content: preview }
  }

  const step: SessionStep = {
    id: info.toolUseId,
    kind: 'tool',
    tool,
    label: humanLabel(info.toolName, info.toolInput),
    status,
  }
  if (target !== undefined) step.target = target
  if (stats.additions !== undefined) step.additions = stats.additions
  if (stats.deletions !== undefined) step.deletions = stats.deletions
  if (detail !== undefined) step.detail = detail
  return step
}

// Surface extended-thinking (reasoning) as a 'thinking' step. `text` is the
// per-block accumulation (the caller appends each delta), so the same `id`
// upserts in place as the reasoning grows. The FULL reasoning (newlines
// preserved) rides in `detail` on EVERY update so the UI can show it streaming
// live (like the Claude extension / Craft Agent), not just a one-line preview;
// `label` stays a capped one-liner for the collapsed row. `status` flips to
// 'done' on thinking_end so the UI can auto-collapse the block.
// Parity with the task path (tasks/trace-mapper.ts → traceThinkingNode).
export function stepFromThinking(id: string, text: string, done = false): SessionStep {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  const label =
    oneLine.length > RESULT_PREVIEW_MAX ? `${oneLine.slice(0, RESULT_PREVIEW_MAX)}…` : oneLine
  const step: SessionStep = {
    id,
    kind: 'thinking',
    label: label || 'Thinking…',
    status: done ? 'done' : 'running',
  }
  const full = text.trim()
  if (full) step.detail = { kind: 'text', content: full }
  return step
}

// Build a 'plan' step from an ExitPlanMode tool call's `plan` markdown. The UI
// renders this as the plan card (StepItem + WorkspacePlanTab). We split the
// markdown into a leading rationale paragraph + a list of concrete steps:
// list lines (-, *, 1.) become planItems; non-list text before the first list
// item becomes the rationale. A plan with no list falls back to one item = the
// whole text so the card is never empty.
export function stepFromPlan(
  id: string,
  plan: string,
  status: PlanStatus = 'pending',
): SessionStep {
  const items: string[] = []
  const rationaleLines: string[] = []
  let seenList = false
  for (const raw of plan.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^(?:[-*]|\d+[.)])\s+(.*)$/)
    if (m) {
      seenList = true
      items.push(m[1].trim())
    } else if (!seenList) {
      rationaleLines.push(line)
    } else if (items.length > 0) {
      // Continuation of the previous list item (wrapped line).
      items[items.length - 1] = `${items[items.length - 1]} ${line}`
    } else {
      rationaleLines.push(line)
    }
  }
  const step: SessionStep = {
    id,
    kind: 'plan',
    label: 'Proposed plan',
    planStatus: status,
    // Raw markdown is authoritative — the UI renders it as a document so the
    // model's own structure (headers, nested lists, bold) survives. The
    // flattened planItems/planRationale below stay for legacy fallback.
    planMarkdown: plan.trim(),
    planItems: items.length > 0 ? items : [plan.trim()],
  }
  const rationale = rationaleLines.join(' ').trim()
  if (rationale) step.planRationale = rationale
  return step
}

// Coerce an AskUserQuestion `questions` arg (model input at start, validated
// details at end) into the SessionQuestion[] shape the UI card consumes. We
// don't fail the turn on a malformed shape — drop bad entries and let the tool's
// own validation surface the error to the model.
function parseQuestions(raw: unknown): SessionQuestion[] {
  if (!Array.isArray(raw)) return []
  const out: SessionQuestion[] = []
  for (const q of raw) {
    if (typeof q !== 'object' || q === null) continue
    const rec = q as Record<string, unknown>
    const header = typeof rec.header === 'string' ? rec.header : ''
    const question = typeof rec.question === 'string' ? rec.question : ''
    if (!header && !question) continue
    const options: SessionQuestionOption[] = []
    if (Array.isArray(rec.options)) {
      for (const o of rec.options) {
        if (typeof o !== 'object' || o === null) continue
        const orec = o as Record<string, unknown>
        const label = typeof orec.label === 'string' ? orec.label : ''
        if (!label) continue
        const opt: SessionQuestionOption = { label }
        if (typeof orec.description === 'string' && orec.description) {
          opt.description = orec.description
        }
        options.push(opt)
      }
    }
    out.push({ header, question, options, multiSelect: rec.multiSelect === true })
  }
  return out
}

// Build a 'question' step from an AskUserQuestion tool call. Emitted from the
// call INPUT on tool_execution_start (status 'running', no answers — the UI
// renders the interactive card) and again on tool_execution_end with the chosen
// answers (status 'done' — the card renders the read-only record). The step id
// is the tool-call id, which is also the parking key + the answerQuestion
// requestId. See docs/features/ask-user-question.md.
export function stepFromQuestion(
  id: string,
  questions: unknown,
  answers?: SessionQuestionAnswer[],
  status: SessionStepStatus = 'running',
): SessionStep {
  const parsed = parseQuestions(questions)
  const step: SessionStep = {
    id,
    kind: 'question',
    label: parsed.length === 1 ? parsed[0].header || 'Question' : 'Questions',
    status,
    questions: parsed,
  }
  if (answers && answers.length > 0) step.answers = answers
  return step
}
