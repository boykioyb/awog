// Built-in session slash commands + the rendered item shapes for the composer
// autocomplete menus. Built-ins are ACTIONS (dispatched when picked, not inserted
// as text); user commands + skills are inserted as `/id ` and expanded on send.
// Mirrors apps/desktop/ui's session-catalog: the only built-in commands are
// permission-mode switches + compact + style (Claude Agent SDK convention).

export type BuiltinAction =
  | { type: 'mode'; mode: 'Ask' | 'Plan' | 'AcceptEdits' | 'Execute' }
  | { type: 'compact' }
  | { type: 'style' }

export type BuiltinCommand = {
  // Stable dispatch id consumed by the composer (e.g. 'mode:Plan', 'compact').
  id: string
  // Slug shown after `/` in the picker and matched against the typed query.
  name: string
  // i18n key for the hint (sessions.command.<x>.desc).
  descKey: string
  action: BuiltinAction
}

export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  {
    id: 'mode:Ask',
    name: 'ask',
    descKey: 'sessions.command.ask.desc',
    action: { type: 'mode', mode: 'Ask' },
  },
  {
    id: 'mode:Plan',
    name: 'plan',
    descKey: 'sessions.command.plan.desc',
    action: { type: 'mode', mode: 'Plan' },
  },
  {
    id: 'mode:AcceptEdits',
    name: 'accept-edits',
    descKey: 'sessions.command.acceptEdits.desc',
    action: { type: 'mode', mode: 'AcceptEdits' },
  },
  {
    id: 'mode:Execute',
    name: 'execute',
    descKey: 'sessions.command.execute.desc',
    action: { type: 'mode', mode: 'Execute' },
  },
  {
    id: 'compact',
    name: 'compact',
    descKey: 'sessions.command.compact.desc',
    action: { type: 'compact' },
  },
  { id: 'style', name: 'style', descKey: 'sessions.command.style.desc', action: { type: 'style' } },
]

export const findBuiltin = (id: string): BuiltinCommand | undefined =>
  BUILTIN_COMMANDS.find((c) => c.id === id)

// ── Rendered item shapes (what the menu components display) ───────────────────

// A `/` row. `kind` drives the tag + whether picking dispatches (builtin) or
// inserts text (command/skill). `desc` is already-resolved (builtin desc is i18n,
// resolved by the composer; user command/skill desc is the on-disk description).
export type SlashItem = {
  key: string
  label: string // text shown after `/` (slug or command/skill id)
  desc: string
  kind: 'builtin' | 'command' | 'skill'
  // For builtin → the dispatch id; for command/skill → the slug to insert.
  builtinId?: string
}

// An `@` row — agent or workspace file. `insert` is the token placed after `@`.
export type MentionRow = {
  key: string
  kind: 'agent' | 'file'
  insert: string
  label: string
  hint?: string
}
