import { BookOpen, type LucideIcon } from 'lucide-vue-next'
import type { AgentMode } from '~/types'
import { MODE_OPTIONS } from './session-modes'

// Slash commands offered in the composer `/` picker. Mirrors craft-agents-oss:
// the only commands a Claude Agent SDK app exposes are permission-mode switches
// and `compact` (the SDK processes `/compact` internally). The Claude Code CLI
// commands (/clear, /save, /export, …) are NOT slash commands here — those are
// session menu / toolbar actions, so they are intentionally absent.

// What picking a command does. Mode commands flip the session's permission mode
// (same set as the composer mode chip); `compact` summarizes the conversation to
// free token budget — wired to the SDK once the runner adopts session resume.
export type SessionCommandAction = { type: 'mode'; mode: AgentMode } | { type: 'compact' }

export interface SessionCommand {
  // Stable id consumed by the composer dispatcher (e.g. 'mode:plan', 'compact').
  id: string
  // Slug shown after `/` in the picker and matched against the typed query.
  name: string
  description: string
  icon: LucideIcon
  action: SessionCommandAction
}

// Derive mode commands from the shared MODE_OPTIONS so labels/icons/descriptions
// stay in sync with the composer mode chip — one source of truth.
const modeCommands: SessionCommand[] = MODE_OPTIONS.map((m) => ({
  id: `mode:${m.value}`,
  name: m.value,
  description: m.desc,
  icon: m.icon,
  action: { type: 'mode', mode: m.value },
}))

export const SESSION_COMMANDS: SessionCommand[] = [
  ...modeCommands,
  {
    id: 'compact',
    name: 'compact',
    description: 'Summarize the conversation to free up token budget',
    icon: BookOpen,
    action: { type: 'compact' },
  },
]

export const findSessionCommand = (id: string): SessionCommand | undefined =>
  SESSION_COMMANDS.find((c) => c.id === id)
