import {
  Eye,
  FolderTree,
  GitCompare,
  Info,
  ListChecks,
  ListTodo,
  TerminalSquare,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import type { WorkspaceTab } from '~/types'

// Single source of truth for the workspace drawer switcher — the header
// dropdown, the drawer header, and the keyboard shortcuts all read this. Order
// mirrors Claude Code's workspace menu.

export interface WorkspaceToolDef {
  id: WorkspaceTab
  icon: Component
  labelKey: string
  // Matched against a keydown event (meta = ⌘ on mac). Absent = no shortcut.
  shortcut?: { ctrl?: boolean; meta?: boolean; shift?: boolean; key: string }
  // Display hint shown in the dropdown.
  shortcutHint?: string
}

export const WORKSPACE_TOOLS: WorkspaceToolDef[] = [
  {
    id: 'preview',
    icon: Eye,
    labelKey: 'workspace.tab.preview',
    shortcut: { meta: true, shift: true, key: 'p' },
    shortcutHint: '⇧⌘P',
  },
  {
    id: 'diff',
    icon: GitCompare,
    labelKey: 'workspace.tab.diff',
    shortcut: { meta: true, shift: true, key: 'd' },
    shortcutHint: '⇧⌘D',
  },
  {
    id: 'terminal',
    icon: TerminalSquare,
    labelKey: 'workspace.tab.terminal',
    shortcut: { ctrl: true, key: '`' },
    shortcutHint: '⌃`',
  },
  {
    id: 'files',
    icon: FolderTree,
    labelKey: 'workspace.tab.files',
    shortcut: { meta: true, shift: true, key: 'f' },
    shortcutHint: '⇧⌘F',
  },
  { id: 'tasks', icon: ListTodo, labelKey: 'workspace.tab.tasks' },
  { id: 'plan', icon: ListChecks, labelKey: 'workspace.tab.plan' },
  // Session metadata — the only tool that works without a bound project.
  { id: 'info', icon: Info, labelKey: 'workspace.tab.info' },
]

export const workspaceTool = (id: WorkspaceTab): WorkspaceToolDef =>
  WORKSPACE_TOOLS.find((tool) => tool.id === id) ?? WORKSPACE_TOOLS[0]!

// True when a keydown matches a tool's shortcut.
export const matchesShortcut = (e: KeyboardEvent, def: WorkspaceToolDef): boolean => {
  const sc = def.shortcut
  if (!sc) return false
  return (
    !!sc.meta === (e.metaKey || false) &&
    !!sc.ctrl === (e.ctrlKey || false) &&
    !!sc.shift === (e.shiftKey || false) &&
    e.key.toLowerCase() === sc.key.toLowerCase()
  )
}
