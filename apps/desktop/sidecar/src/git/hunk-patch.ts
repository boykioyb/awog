// Build a minimal unified-diff patch = one file header + a single hunk, ready to
// pipe to `git apply`. Shared by git.stageHunk (forward apply to the index) and
// git.unstageHunk (`--reverse`). Patch lines use '\n'; git apply normalizes per
// the repo's core.autocrlf, and `--recount` on the apply side ignores the @@
// line counts (the body is rebuilt) so they need not be exact.
import type { GitDiffHunk, GitDiffLine } from './types.js'

// Reconstruct a raw diff body line from a parsed GitDiffLine. `noeol` keeps the
// `\ No newline at end of file` marker verbatim.
function diffLineToRaw(line: GitDiffLine): string {
  if (line.kind === 'noeol') return line.content
  const prefix = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '
  return `${prefix}${line.content}`
}

export function buildHunkPatch(relPath: string, hunk: GitDiffHunk): string {
  const header = [
    `diff --git a/${relPath} b/${relPath}`,
    `--- a/${relPath}`,
    `+++ b/${relPath}`,
    hunk.header,
  ]
  const body = hunk.lines.map(diffLineToRaw)
  // Trailing newline is required for `git apply` to accept the patch.
  return `${[...header, ...body].join('\n')}\n`
}
