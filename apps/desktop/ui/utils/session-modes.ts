import { CheckCheck, HelpCircle, ListChecks, Play, type LucideIcon } from 'lucide-vue-next'
import type { AgentMode } from '~/types'

export interface ModeOption {
  value: AgentMode
  label: string
  icon: LucideIcon
  desc: string
}

// Single source for the four permission modes — consumed by the composer mode
// chip (SessionChipsPopover) and the `/` command picker (session-catalog), so
// the label/icon/description stay in sync across both affordances.
export const MODE_OPTIONS: ModeOption[] = [
  {
    value: 'ask',
    label: 'Ask',
    icon: HelpCircle,
    desc: 'Read-only tools run freely; any write or shell command prompts you first.',
  },
  {
    value: 'accept-edits',
    label: 'Accept Edits',
    icon: CheckCheck,
    desc: 'Auto-approve file edits (Edit / Write / MultiEdit). Shell commands still prompt.',
  },
  {
    value: 'plan',
    label: 'Plan',
    icon: ListChecks,
    desc: 'Research-only — the model investigates and proposes a plan, no writes or shell.',
  },
  {
    value: 'execute',
    label: 'Execute',
    icon: Play,
    desc: 'Bypass all prompts — edits AND shell commands run without confirmation. Use with care.',
  },
]
