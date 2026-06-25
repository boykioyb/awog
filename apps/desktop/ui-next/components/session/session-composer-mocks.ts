// MOCK sources for the composer autocomplete (§2). NONE of this is wired to a real
// command backend or workspace index — it's a small built-in list so the slash `/`
// and `@`-mention menus have something to show. Swap for engine-backed lookups when
// commands.* / a workspace file index land.

// Built-in slash commands. `descKey` is an i18n key (sessions.command.<id>.desc) so
// the dropdown can localise the hint without baking strings into the mock.
export type SlashCommand = { name: string; descKey: string }

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/plan', descKey: 'sessions.command.plan.desc' },
  { name: '/clear', descKey: 'sessions.command.clear.desc' },
  { name: '/compact', descKey: 'sessions.command.compact.desc' },
  { name: '/model', descKey: 'sessions.command.model.desc' },
  { name: '/help', descKey: 'sessions.command.help.desc' },
]

// `@`-mention candidates — a flat mock list of agents + files. `value` is the token
// inserted after the `@`; `kind` drives the row's tag + accent.
export type MentionItem = { kind: 'agent' | 'file'; value: string }

export const MENTION_SOURCE: MentionItem[] = [
  { kind: 'agent', value: 'developer' },
  { kind: 'agent', value: 'tech-lead' },
  { kind: 'agent', value: 'infosec' },
  { kind: 'agent', value: 'qa-tester' },
  { kind: 'file', value: 'apps/desktop/ui-next/components/session/SessionComposer.vue' },
  { kind: 'file', value: 'apps/desktop/ui-next/stores/sessions.ts' },
  { kind: 'file', value: 'docs/architecture/system-overview.md' },
  { kind: 'file', value: 'CLAUDE.md' },
]
