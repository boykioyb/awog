// Catalog of built-in Claude Code tools (via @anthropic-ai/claude-agent-sdk).
// Used by the Tools popover to render the per-session enable/disable list.
//
// Names MUST match the SDK's exact tool names so disabling a tool in Options
// .disallowedTools actually filters it out — verified against sdk.d.ts.

import {
  Brain,
  Edit3,
  FileText,
  FolderSearch,
  Globe,
  ListChecks,
  type LucideIcon,
  Save,
  Search,
  Sparkles,
  Terminal,
} from 'lucide-vue-next'

export type ToolGroup = 'file' | 'shell' | 'search' | 'web' | 'meta'

export interface ToolDef {
  name: string // SDK tool name — passed to disallowedTools when off
  label: string // Display label
  group: ToolGroup
  icon: LucideIcon
  description: string
  // Whether the tool is generally safe to disable. Some (TodoWrite,
  // EnterPlanMode/ExitPlanMode) are housekeeping the model uses to structure
  // its own work — disabling them rarely helps users.
  housekeeping?: boolean
}

export const TOOL_GROUP_LABEL: Record<ToolGroup, string> = {
  file: 'File',
  shell: 'Shell',
  search: 'Search',
  web: 'Web',
  meta: 'Meta',
}

export const TOOLS_CATALOG: ToolDef[] = [
  // File
  {
    name: 'Read',
    label: 'Read',
    group: 'file',
    icon: FileText,
    description: 'Read a file from the project workspace.',
  },
  {
    name: 'Write',
    label: 'Write',
    group: 'file',
    icon: Save,
    description: 'Create or overwrite a file (gated by permission prompt).',
  },
  {
    name: 'Edit',
    label: 'Edit',
    group: 'file',
    icon: Edit3,
    description: 'Apply a targeted edit to an existing file.',
  },
  {
    name: 'MultiEdit',
    label: 'MultiEdit',
    group: 'file',
    icon: Edit3,
    description: 'Apply several edits to a single file in one go.',
  },
  {
    name: 'NotebookEdit',
    label: 'NotebookEdit',
    group: 'file',
    icon: Edit3,
    description: 'Edit a Jupyter notebook cell.',
  },
  // Shell
  {
    name: 'Bash',
    label: 'Bash',
    group: 'shell',
    icon: Terminal,
    description: 'Run a shell command in the project workspace.',
  },
  {
    name: 'BashOutput',
    label: 'BashOutput',
    group: 'shell',
    icon: Terminal,
    description: 'Tail / fetch output from a long-running shell job.',
  },
  // Search
  {
    name: 'Glob',
    label: 'Glob',
    group: 'search',
    icon: FolderSearch,
    description: 'Match files by pattern (e.g. **/*.ts).',
  },
  {
    name: 'Grep',
    label: 'Grep',
    group: 'search',
    icon: Search,
    description: 'Full-text search across project files.',
  },
  // Web
  {
    name: 'WebSearch',
    label: 'WebSearch',
    group: 'web',
    icon: Globe,
    description: 'Search the public web.',
  },
  {
    name: 'WebFetch',
    label: 'WebFetch',
    group: 'web',
    icon: Globe,
    description: 'Fetch and parse a URL (subject to permission).',
  },
  // Meta
  {
    name: 'Task',
    label: 'Task (subagent)',
    group: 'meta',
    icon: Sparkles,
    description: 'Spawn a subagent for a focused subtask.',
  },
  {
    name: 'TodoWrite',
    label: 'TodoWrite',
    group: 'meta',
    icon: ListChecks,
    description: "Maintain the model's internal todo list.",
    housekeeping: true,
  },
  {
    name: 'EnterPlanMode',
    label: 'EnterPlanMode',
    group: 'meta',
    icon: Brain,
    description: 'Enter plan mode (research-only).',
    housekeeping: true,
  },
  {
    name: 'ExitPlanMode',
    label: 'ExitPlanMode',
    group: 'meta',
    icon: Brain,
    description: 'Exit plan mode and propose final plan.',
    housekeeping: true,
  },
]

export const TOOL_NAMES = TOOLS_CATALOG.map((t) => t.name)
