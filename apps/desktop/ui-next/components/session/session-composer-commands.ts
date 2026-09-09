// Built-in session slash commands + the rendered item shapes for the composer
// autocomplete menus. Built-ins are ACTIONS (dispatched when picked, not inserted
// as text); user commands + skills are inserted as `/id ` and expanded on send.
// Mirrors apps/desktop/ui's session-catalog: the only built-in commands are
// permission-mode switches + compact + style (Claude Agent SDK convention).

export type BuiltinAction =
  | { type: 'mode'; mode: 'Ask' | 'Plan' | 'AcceptEdits' | 'Execute' }
  | { type: 'compact' }
  | { type: 'style' }
  // `/browser [url]` — mở url trong trình duyệt nhúng của app (ADR 0086) rồi hiện
  // view Browser của workspace panel. Hành động của NGƯỜI DÙNG: không có tin nhắn
  // nào gửi cho model, và url gõ sau lệnh là ĐỐI SỐ (xem `takesArg`).
  | { type: 'browser' }

export type BuiltinCommand = {
  // Stable dispatch id consumed by the composer (e.g. 'mode:Plan', 'compact').
  id: string
  // Slug shown after `/` in the picker and matched against the typed query.
  name: string
  // i18n key for the hint (sessions.command.<x>.desc).
  descKey: string
  action: BuiltinAction
  // Lệnh ăn luôn phần text sau slug làm đối số (`/browser example.com`) thay vì để lại
  // trong draft — và vì thế phải chạy cả khi người dùng Enter lúc menu đã đóng (Esc):
  // nếu không, cả dòng `/browser example.com` sẽ bị gửi cho model như một prompt.
  takesArg?: boolean
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
  {
    id: 'browser',
    name: 'browser',
    descKey: 'sessions.command.browser.desc',
    action: { type: 'browser' },
    takesArg: true,
  },
]

export const findBuiltin = (id: string): BuiltinCommand | undefined =>
  BUILTIN_COMMANDS.find((c) => c.id === id)

// Slug của hàng `@page`. Hằng riêng vì cả bộ lọc theo query lẫn hàng dựng ra đều
// phải khớp chính xác một chuỗi.
export const MENTION_PAGE = 'page'

// ── Rendered item shapes (what the menu components display) ───────────────────

// A `/` row. `kind` drives the tag + whether picking dispatches (builtin) or
// inserts text (command/skill/cli). `desc` is already-resolved (builtin desc is
// i18n, resolved by the composer; user command/skill desc is the on-disk
// description; cli desc comes from the CLI itself).
//   • command/skill → the body is expanded into the prompt on send (AWOG-side).
//   • cli           → the `/name args` text is sent to the Claude CLI VERBATIM and
//                     the CLI runs it (Claude SDK branch only).
export type SlashItem = {
  key: string
  label: string // text shown after `/` (slug, command/skill id, or CLI command name)
  desc: string
  kind: 'builtin' | 'command' | 'skill' | 'cli'
  // For builtin → the dispatch id; for command/skill/cli → the slug to insert.
  builtinId?: string
}

// Claude-CLI commands we deliberately keep OUT of the `/` menu even though the CLI
// advertises them. Everything else it reports is offered as-is.
//   • `clear`   — resets the CLI conversation while AWOG keeps the transcript on
//                 screen: the model would silently lose the context the user can
//                 still read. Rewind / fork are the AWOG-side equivalents.
//   • `compact` — AWOG owns compaction (ADR 0047: always Pi, persists a checkpoint);
//                 the `/compact` built-in row already drives it.
// Names starting with `__` are the CLI's internal plumbing, never user-facing.
const CLI_COMMAND_DENY = new Set(['clear', 'compact'])

export const isOfferableCliCommand = (name: string): boolean =>
  !name.startsWith('__') && !CLI_COMMAND_DENY.has(name)

// An `@` row — agent, skill, wiki page, workspace file, or the `@page` ACTION.
// `insert` is the token placed after `@`.
export type MentionRow = {
  key: string
  // 'wiki' inserts `@wiki:<slug>` — a page reference the model resolves with the
  // wiki_read tool, not a filesystem path (the wiki lives outside the workspace).
  // 'skill' inserts `@skill:<id>` — prefixed for the same reason: a skill id and
  // an agent handle share one namespace, so a bare `@code-reviewer` would be
  // ambiguous when both exist.
  // 'page' KHÔNG chèn token nào: nó là một hành động (như built-in của menu `/`) —
  // chọn nó thì trang đang mở trong trình duyệt nhúng được chèn thành khối context
  // (useBrowserContext().attachPage). Vì thế `insert` của nó không bao giờ được dùng.
  kind: 'agent' | 'skill' | 'file' | 'wiki' | 'page'
  insert: string
  label: string
  hint?: string
}
