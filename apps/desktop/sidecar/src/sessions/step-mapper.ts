// Mapping from Claude Agent SDK tool_use/tool_result events to the UI's
// SessionStep shape. UI's StepItem.vue uses a fixed StepTool union
// ('read' | 'write' | 'edit' | 'save' | 'search' | 'find-files' | 'terminal' |
// 'task'); SDK tool names are open-ended (Read, Edit, Write, Bash, Glob, Grep,
// WebSearch, WebFetch, NotebookEdit, Task, …). We normalise here so the sidecar
// can emit step events that the existing component renders without changes.

import type {
  PlanStatus,
  SessionStep,
  SessionStepDetail,
  SessionStepStatus,
  SessionStepTool,
} from '../types/shared.js'

// Truncation cap for tool_result preview text. Keeps step payloads small over
// stdio and bounds in-memory cost when the model dumps a huge file read.
const RESULT_PREVIEW_MAX = 2_000

// Cap a long string for the step detail/inline preview. Shared by the Task
// prompt stash, the Write content dump, and the tool_result preview.
function truncatePreview(text: string): string {
  return text.length > RESULT_PREVIEW_MAX
    ? `${text.slice(0, RESULT_PREVIEW_MAX)}\n…(truncated)`
    : text
}

// Map of SDK built-in tool names → UI StepTool. Unknown tools fall through to
// 'task' so the step still renders (icon = sparkles).
const TOOL_NAME_MAP: Record<string, SessionStepTool> = {
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Bash: 'terminal',
  BashOutput: 'terminal',
  Glob: 'find-files',
  Grep: 'search',
  WebSearch: 'search',
  WebFetch: 'search',
  Task: 'task',
  TodoWrite: 'task',
  ExitPlanMode: 'task',
  EnterPlanMode: 'task',
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
  const path = input.path
  if (typeof path === 'string' && path.length > 0) return path
  const pattern = input.pattern
  if (typeof pattern === 'string' && pattern.length > 0) return pattern
  const cmd = input.command
  if (typeof cmd === 'string' && cmd.length > 0) {
    // Compact long commands so the inline step label stays one line. Detail
    // pane shows the full string via terminal detail kind.
    return cmd.length > 60 ? `${cmd.slice(0, 57)}…` : cmd
  }
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
    case 'Task': {
      // Format: "Agent <subagent_type>" so the step row reads like Claude Code's
      // "Ran agent X" affordance. Falls back to plain "Subagent" when unknown.
      const sub = typeof input.subagent_type === 'string' ? input.subagent_type : ''
      return sub ? `Agent ${sub}` : 'Subagent'
    }
    case 'TodoWrite':
      return 'Todos'
    case 'ExitPlanMode':
      return 'Exit plan'
    case 'EnterPlanMode':
      return 'Enter plan'
    default:
      return toolName
  }
}

export interface ToolUseInfo {
  id: string
  name: string
  input: Record<string, unknown>
}

export function stepFromToolUse(info: ToolUseInfo): SessionStep {
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

// Convert SDK tool_result content (string | unknown[]) to a single preview.
// Truncates aggressively — the UI's step inline view doesn't need full output.
function previewToolResult(content: unknown): string {
  if (typeof content === 'string') {
    return truncatePreview(content)
  }
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
    return truncatePreview(parts.join('\n'))
  }
  return ''
}

export interface ToolResultInfo {
  toolUseId: string
  toolName: string
  toolInput: Record<string, unknown>
  content: unknown
  isError: boolean
}

export function stepFromToolResult(info: ToolResultInfo): SessionStep {
  const status: SessionStepStatus = info.isError ? 'error' : 'done'
  const tool = pickStepTool(info.toolName)
  const target = pickTarget(info.toolName, info.toolInput)
  const stats = pickDiffStats(info.toolName, info.toolInput)
  const preview = previewToolResult(info.content)

  // Detail panel: terminal output for Bash, file dump for Read/Write, otherwise
  // a plain text panel so the user can drill in for context. We don't render
  // 'diff' here (UI's diff viewer needs a real unified-diff string we don't
  // have); StepItem still shows additions/deletions counters inline.
  let detail: SessionStepDetail | undefined
  if (info.toolName === 'Bash') {
    const command = typeof info.toolInput.command === 'string' ? info.toolInput.command : ''
    detail = { kind: 'terminal', command, output: preview }
  } else if (info.toolName === 'Read') {
    const path = typeof info.toolInput.file_path === 'string' ? info.toolInput.file_path : ''
    detail = { kind: 'file', path, content: preview }
  } else if (info.toolName === 'Write') {
    // The tool result is just "Wrote N bytes to …". Show the written content
    // (from the input) instead so the detail pane renders the file.
    const path = typeof info.toolInput.file_path === 'string' ? info.toolInput.file_path : ''
    const content = typeof info.toolInput.content === 'string' ? info.toolInput.content : ''
    detail =
      content.length > 0
        ? { kind: 'file', path, content: truncatePreview(content) }
        : { kind: 'text', content: preview }
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
    planItems: items.length > 0 ? items : [plan.trim()],
  }
  const rationale = rationaleLines.join(' ').trim()
  if (rationale) step.planRationale = rationale
  return step
}
