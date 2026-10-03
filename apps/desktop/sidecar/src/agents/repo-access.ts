// Agent repo-access helpers. `repos` on an Agent is a whitelist of absolute
// repository paths the agent may touch:
//   - EVERY runtime gets the <repo_access> prompt boundary (repoAccessBlock).
//   - The Pi/Codex toolsets additionally NARROW their fs-tool roots to the
//     resolved list (resolveAgentFsRoots) so a wrong path is denied at the
//     tool boundary, not just discouraged in prose.
// Bash is intentionally not re-rooted: it is permission-gated (EXEC_TOOLS)
// and a repo-scoped member still legitimately runs package commands — the
// boundary + fs gating cover the file-touch surface.
import { sep } from 'node:path'

const isInside = (p: string, root: string): boolean => {
  const r = root.endsWith(sep) ? root : root + sep
  return p === root || p.startsWith(r)
}

// System-prompt boundary text. Appended to the resolved agent prompt so the
// restriction reads as part of the role contract, not session trivia.
export function repoAccessBlock(repos: string[]): string {
  const lines = repos.map((r) => `- ${r}`).join('\n')
  return `<repo_access>
Only work inside these repositories:
${lines}
Do not read, create, or modify files outside this list.
</repo_access>`
}

// Effective fs roots for a session bound to an agent with `repos`.
//   - cwd inside a listed repo (member worktree lives under the repo) → keep
//     cwd as base, add repos OUTSIDE it (cross-repo access is the intent).
//   - every listed repo nests UNDER cwd (container project) → narrow to the
//     repos: sibling dirs the agent wasn't granted are denied.
//   - otherwise → union: keep cwd plus whatever repos are unrelated.
// Undefined return = unrestricted (the legacy cwd-only behaviour).
export function resolveAgentFsRoots(cwd: string, repos: string[] | undefined): string[] | undefined {
  if (!repos || repos.length === 0) return undefined
  const covered = repos.some((r) => isInside(cwd, r))
  const under = repos.filter((r) => isInside(r, cwd))
  const outside = repos.filter((r) => !isInside(r, cwd) && !isInside(cwd, r))
  const roots = covered
    ? [cwd, ...outside]
    : under.length === repos.length
      ? under
      : [cwd, ...outside]
  return [...new Set(roots)]
}
