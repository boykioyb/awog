import { homedir } from 'node:os'
import { resolve } from 'node:path'

// AWOG home holds the data AWOG alone owns: credentials, sessions, projects,
// workflows, sources, tasks, ssh/vpn, settings, hooks and rules.
export function awogHome(): string {
  return resolve(homedir(), '.awog')
}

// Claude home is the SHARED config surface (ADR 0070): the three config kinds
// Claude Code has a native on-disk layout for — skills/, agents/, commands/ —
// live here, so AWOG and the Claude Code CLI read and write the SAME files
// instead of AWOG keeping a stale imported copy under ~/.awog.
//
// `CLAUDE_CONFIG_DIR` is honoured because the Claude Code CLI honours it: the
// SDK subprocess we spawn inherits the sidecar's env (runtime/claude-sdk/
// shared.ts no longer overrides it), so both sides MUST resolve to the same dir
// or the Skill tool would look somewhere AWOG never wrote.
export function claudeHome(): string {
  const override = process.env.CLAUDE_CONFIG_DIR
  if (override && override.trim().length > 0) return resolve(override.trim())
  return resolve(homedir(), '.claude')
}

// Per-project counterpart of claudeHome(): `{project}/.claude/{kind}` — the
// layout Claude Code already reads for project-scoped skills/agents/commands.
export function projectClaudeDir(projectPath: string): string {
  return resolve(projectPath, '.claude')
}

// Separators and `..` are the obvious traversal shapes. A BARE `.` is the subtle
// one: `join(dir, '.')` normalises to `dir` itself, so an id of "." turns a
// delete-by-id into an `rm -rf` of the whole store (sessions/agents/skills/…).
const ILLEGAL_CHILD_RE = /[/\\]|\.\.|^\.$/

// Guard against path traversal when composing paths from method params or
// computed names. Caller should always concat result with awogHome().
export function sanitizeChild(name: string): string {
  if (!name || ILLEGAL_CHILD_RE.test(name)) {
    throw new Error(`Illegal path segment: ${name}`)
  }
  return name
}
