// Slash-command expansion for the session composer (ported from apps/desktop/ui).
// A user types `/<name> [args]` and on send the matching user command's body is
// expanded into the prompt, with `$ARGUMENTS` / `$1`…`$9` substituted. Pure
// functions — no store/DOM access — so they are testable and reusable.

// Minimal shape needed to resolve an invocable command (full Command lives in the
// sidecar; the composer only needs id/body/scope to expand on send).
export type CommandLike = {
  id: string
  body: string
  enabled?: boolean
  source?: 'global' | 'project'
  projectId?: string
}

export type SlashInvocation = {
  name: string
  args: string
}

// Parse a composer draft as a slash invocation. Returns null unless the trimmed
// text begins with `/` followed by a non-empty, whitespace-free name. Everything
// after the name (across newlines) is the raw argument string.
export const parseSlashInvocation = (text: string): SlashInvocation | null => {
  const m = text.trim().match(/^\/(\S+)([\s\S]*)$/)
  if (!m || !m[1]) return null
  return { name: m[1], args: (m[2] ?? '').trim() }
}

// A command is invocable from a session if it is enabled and applies to scope:
// global always applies; project applies only to the session's bound project.
// Matched by id (the slug typed after `/`).
export const findInvocableCommand = <T extends CommandLike>(
  commands: T[],
  name: string,
  projectId: string | null,
): T | undefined =>
  commands.find((c) => {
    if (c.id !== name || c.enabled === false) return false
    const source = c.source ?? 'global'
    if (source === 'global') return true
    return !!projectId && c.projectId === projectId
  })

// Substitute argument tokens in a command body. `$ARGUMENTS` → the full arg
// string; `$1`…`$9` → positional tokens (whitespace-split). Tokens without a
// matching argument expand to an empty string. Unknown `$N` (≥ $10) are left
// untouched. If the body uses no token, args are intentionally NOT auto-appended
// (matches Claude Code) — the command author opts in via `$ARGUMENTS`.
export const expandCommandBody = (body: string, args: string): string => {
  const positional = args.length > 0 ? args.split(/\s+/) : []
  return body
    .replace(/\$ARGUMENTS\b/g, args)
    .replace(/\$([1-9])\b/g, (_, d: string) => positional[Number(d) - 1] ?? '')
}
